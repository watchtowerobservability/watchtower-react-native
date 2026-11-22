'use strict';
// Client storage instrumentation, pass-the-module style: the app hands over its own module or
// instance, so none of these libraries is a dependency. Only slow or failed calls are recorded, as
// `db` events (value = duration ms). Synchronous calls block the JS thread, which drives rendering:
// they are judged against one frame and flagged `db.main_thread`. Statement text and values are never sent.
const { get } = require('./client');
const { newSpanId } = require('./util');

const FRAME_MS = 16;
const DEFAULT_SLOW_MS = 100;

const OP = /^\s*(?:with\b[\s\S]*?\)\s*)?([a-z]+)/i;
const TARGET = /\b(?:from|into|update|join|table)\s+((?:"[^"]+"|`[^`]+`|\[[^\]]+\]|[\w$]+)(?:\.(?:"[^"]+"|[\w$]+))?)/i;

/** `SELECT users`-style parts (same rules as the Node and browser SDKs): never values or the statement text. */
function querySummary(sql) {
  const text = typeof sql === 'string' ? sql : '';
  const m = text.match(OP);
  const t = text.match(TARGET);
  return { operation: m ? m[1].toUpperCase() : 'QUERY', collection: t ? t[1].replace(/["`[\]]/g, '') : undefined };
}

const errType = (e) => {
  const code = e && e.code;
  return typeof code === 'string' || typeof code === 'number' ? String(code) : (e && e.name) || 'Error';
};

/** One `db` event when the op was slow or failed. */
function report(op, slowMs) {
  const c = get();
  if (!c) return;
  const limit = op.mainThread ? Math.min(slowMs, FRAME_MS) : slowMs;
  if (!op.error && op.ms < limit) return;
  const summary = [op.operation, op.collection].filter(Boolean).join(' ');
  c.record('db', summary, {
    ...op.attrs,
    'db.system.name': op.system,
    'db.operation.name': op.operation,
    'db.query.summary': summary,
    'db.collection.name': op.collection,
    'db.namespace': op.namespace,
    'db.main_thread': op.mainThread || undefined,
    'error.type': op.error,
  }, Math.round(op.ms), { traceId: c.trace.traceId, spanId: newSpanId() });
}

/**
 * Wraps `obj[name]` in place. `describe(args)` gives `{ operation, collection }`. A promise result is
 * timed when it settles; a plain result was computed on the JS thread.
 */
function wrap(obj, name, base, describe, slowMs) {
  const orig = obj && obj[name];
  if (typeof orig !== 'function' || orig.__wt) return;
  const w = function (...args) {
    if (!get()) return orig.apply(this, args);
    const d = describe(args, name);
    const t0 = Date.now();
    const done = (error, async) => report({ ...base, ...d, ms: Date.now() - t0, error, mainThread: !async }, slowMs);
    let r;
    try {
      r = orig.apply(this, args);
    } catch (e) {
      done(errType(e), false);
      throw e;
    }
    if (r && typeof r.then === 'function') r.then(() => done(undefined, true), (e) => done(errType(e), true));
    else done(undefined, false);
    return r;
  };
  w.__wt = true;
  obj[name] = w;
}

const byName = (_a, name) => ({ operation: name });
const bySql = (a) => querySummary(a[0]);

/** `@react-native-async-storage/async-storage` default export. */
function instrumentAsyncStorage(storage, { slowMs = DEFAULT_SLOW_MS } = {}) {
  for (const m of ['getItem', 'setItem', 'removeItem', 'mergeItem', 'clear', 'getAllKeys', 'multiGet', 'multiSet', 'multiRemove', 'multiMerge']) {
    wrap(storage, m, { system: 'asyncstorage' }, byName, slowMs);
  }
  return storage;
}

/** `react-native-mmkv` instance (synchronous JSI, so always on the JS thread). Reports its file size once, when it exposes `size`. */
function instrumentMMKV(mmkv, { name = mmkv && mmkv.id, slowMs = DEFAULT_SLOW_MS } = {}) {
  for (const m of ['set', 'getString', 'getNumber', 'getBoolean', 'getBuffer', 'contains', 'delete', 'remove', 'getAllKeys', 'clearAll', 'trim']) {
    wrap(mmkv, m, { system: 'mmkv', namespace: name }, byName, slowMs);
  }
  if (mmkv && typeof mmkv.size === 'number') recordStoreSize('mmkv', mmkv.size, { namespace: name });
  return mmkv;
}

/**
 * A SQLite handle: op-sqlite / quick-sqlite / nitro-sqlite (`execute`, `executeAsync`, `executeSync`)
 * and expo-sqlite (`runAsync`, `getAllAsync`, `getFirstAsync`, `execAsync` and the `*Sync` forms).
 */
function instrumentSQLite(db, { name, slowMs = DEFAULT_SLOW_MS } = {}) {
  const base = { system: 'sqlite', namespace: name };
  for (const m of ['execute', 'executeAsync', 'executeSync', 'runAsync', 'getAllAsync', 'getFirstAsync', 'execAsync', 'runSync', 'getAllSync', 'getFirstSync', 'execSync']) {
    wrap(db, m, base, bySql, slowMs);
  }
  wrap(db, 'executeBatch', base, () => ({ operation: 'BATCH' }), slowMs);
  return db;
}

/** WatermelonDB `Database`: its adapter's `query`, `count`, `find` and `batch`. */
function instrumentWatermelon(database, { name, slowMs = DEFAULT_SLOW_MS } = {}) {
  const table = (q) => (q && (q.table || (q.modelClass && q.modelClass.table))) || undefined;
  const describe = (a, op) => ({ operation: op, collection: op === 'find' ? a[0] : op === 'batch' ? undefined : table(a[0]) });
  for (const m of ['query', 'count', 'find', 'batch']) wrap(database && database.adapter, m, { system: 'watermelondb', namespace: name }, describe, slowMs);
  return database;
}

/** Realm JS instance: `write` transactions (synchronous, on the JS thread). */
function instrumentRealm(realm, { name, slowMs = DEFAULT_SLOW_MS } = {}) {
  const ns = name || (realm && typeof realm.path === 'string' ? realm.path.split('/').pop() : undefined);
  wrap(realm, 'write', { system: 'realm', namespace: ns }, () => ({ operation: 'write' }), slowMs);
  return realm;
}

/** A store's on-disk size (from your own file-system module): a `storage` event `wt.embedded.file_size`. */
function recordStoreSize(system, bytes, { namespace, walBytes } = {}) {
  const c = get();
  if (!c || !Number.isFinite(bytes)) return;
  c.record('storage', 'wt.embedded.file_size', { 'db.system.name': system, 'db.namespace': namespace }, bytes);
  if (Number.isFinite(walBytes)) c.record('storage', 'wt.embedded.wal_size', { 'db.system.name': system, 'db.namespace': namespace }, walBytes);
}

module.exports = {
  querySummary, instrumentAsyncStorage, instrumentMMKV, instrumentSQLite, instrumentWatermelon, instrumentRealm, recordStoreSize,
};
