'use strict';
const { newId, newTraceId, newSpanId, safeAttrs, maskKey } = require('./util');
const { sha256Hex } = require('./sha256');

const SDK = { name: 'watchtower.react-native', version: '0.2.0' };
const DEFAULT_ENDPOINT = 'http://localhost:4318';
const QUEUE_MAX = 500;
const FLUSH_EVENTS = 50;
const FLUSH_MS = 5000;
const CRUMBS_MAX = 50;

/** The single client. `init` replaces it, `close` clears it; every public function is a no-op when it is null. */
let client = null;

function env(name) {
  try { return typeof process !== 'undefined' && process.env ? process.env[name] : undefined; } catch (_) { return undefined; }
}

function loadNative() {
  try {
    const m = require('react-native').NativeModules.WatchtowerRN;
    return m && typeof m.record === 'function' ? m : null;
  } catch (_) { return null; }
}

/** The OTA update id (expo-updates, optional peer); null in embedded builds or without expo-updates. */
function updateId() {
  try { return require('expo-updates').updateId || undefined; } catch (_) { return undefined; }
}

/**
 * Native SDK knobs passed through the bridge (null = native default): native screen views, native
 * URLSession/HttpURLConnection-level resources, hang/ANR threshold, launch profiling, build id for
 * symbolication, and the propagateTo prefixes for native traceparent injection.
 */
function nativeStartOptions(cfg) {
  const n = cfg.nativeOptions || {};
  const pick = (k) => (n[k] === undefined ? null : n[k]);
  return {
    trackViews: pick('trackViews'),
    trackNetwork: pick('trackNetwork'),
    hangThresholdMs: pick('hangThresholdMs'),
    profileLaunch: pick('profileLaunch'),
    buildId: pick('buildId'),
    propagateTo: Array.isArray(n.propagateTo) ? n.propagateTo : cfg.tracePropagationTargets.filter((t) => typeof t === 'string'),
  };
}

/** Native-collected telemetry (native crashes, hangs, launch, frames, native views and resources) goes straight to the native buffer. */
class Client {
  constructor(o) {
    if (!o || !o.key) throw new Error('watchtower: `key` (publishable ingest key) is required');
    if (!String(o.key).startsWith('wtp_')) throw new Error('watchtower: a mobile app must use a publishable key (wtp_...), never a secret key');
    this.cfg = {
      key: o.key,
      service: o.service || env('WT_SERVICE') || 'app',
      endpoint: String(o.endpoint || env('WT_OTLP_ENDPOINT') || DEFAULT_ENDPOINT).replace(/\/+$/, ''),
      environment: o.environment || env('WT_ENVIRONMENT'),
      release: o.release || env('WT_RELEASE'),
      redact: o.redact,
      debug: !!o.debug,
      replay: o.replay,
      tracePropagationTargets: o.tracePropagationTargets || [],
      crashLoopThreshold: o.crashLoopThreshold,
      nativeOptions: o.nativeOptions,
      dist: o.dist || updateId(),
    };
    this.fetch = o.fetch || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    this.native = o.native === undefined ? loadNative() : o.native;
    // An app sends no Origin: the edge accepts the key only with this id on its app id list.
    this.cfg.appId = o.appId || (this.native && this.native.appId) || undefined;
    this.sessionId = newId();
    this.context = {};
    this.crumbs = [];
    this.queue = [];
    this.trace = { traceId: newTraceId(), spanId: newSpanId() };
    this.failures = 0;
    this.retryAt = 0;
    this.timer = null;
    this.cleanups = [];
    this.now = o.now || Date.now;
    this.userHash = undefined;
    this.userP = null;
    this.warned = {};
    this.startNativeWanted = o.startNative !== false;
    // Without an explicit option, a denial persisted by `stop()` / `setConsent('denied')` holds across launches.
    this.consent = o.consent || (this.native && this.native.stopped === true ? 'denied' : 'granted');
    if (this.consent === 'granted') this.startNative(o.consent === 'granted');
  }

  /** `explicit`: the app granted consent, which also lifts a denial persisted natively. */
  startNative(explicit) {
    if (!this.native || !this.startNativeWanted || typeof this.native.start !== 'function') return;
    const { key, service, endpoint, environment, release, replay, crashLoopThreshold } = this.cfg;
    try {
      this.native.start({
        key, service, endpoint, environment, release, replay: replay || null, crashLoopThreshold: crashLoopThreshold || null,
        consent: explicit ? 'granted' : null,
        ...nativeStartOptions(this.cfg),
      });
    } catch (_) { /* native start is best effort */ }
  }

  /** 'granted' starts capture (and native capture); 'denied' is `stop()`. 'pending' only exists at init. */
  setConsent(v) {
    if (v === 'granted') {
      if (this.consent === 'granted') return;
      this.consent = 'granted';
      this.startNative(true);
    } else if (v === 'denied') this.stop();
  }

  /** Stop now: native crash handler removed, native crash buffer deleted, timers and queues cleared, denial persisted natively. */
  stop() {
    this.consent = 'denied';
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.queue = [];
    this.crumbs = [];
    this.userHash = undefined;
    this.userP = null;
    if (this.native && typeof this.native.stop === 'function') { try { this.native.stop(); } catch (_) { /* best effort */ } }
  }

  /** Like the browser SDK: SHA-256 of `salt:id` (salt from `/v1/rum/config`); the raw id is never sent. `null` clears. */
  setUser(u) {
    const id = u && u.id != null ? String(u.id) : '';
    this.userHash = undefined;
    this.userP = null;
    if (!id || this.consent !== 'granted') return;
    if (!this.saltP) {
      this.saltP = Promise.resolve().then(() => this.fetch(`${this.cfg.endpoint}/v1/rum/config`, { headers: this.headers() }))
        .then((r) => (r.ok ? r.json() : {})).then((j) => (j && typeof j.id_salt === 'string' ? j.id_salt : '')).catch(() => '');
    }
    const p = this.saltP.then((salt) => { if (this.userP === p) this.userHash = sha256Hex(`${salt}:${id}`); });
    this.userP = p;
  }

  warnOnce(k, msg) {
    if (this.warned[k]) return;
    this.warned[k] = true;
    console.warn(`[watchtower] ${msg}`);
  }

  /**
   * The native crash-loop guard (DX 15): JS fatals end the process through the native crash
   * handler, so the native SDK counts them with native crashes. Without the native module: none.
   */
  async crashLoop() {
    const none = { launchCrashCount: 0, isCrashLooping: false };
    if (!this.native || typeof this.native.crashLoop !== 'function') return none;
    try {
      const r = await this.native.crashLoop();
      const n = Number(r && r.launchCrashCount) || 0;
      return { launchCrashCount: n, isCrashLooping: !!(r && r.isCrashLooping) };
    } catch (_) { return none; }
  }

  /** Headers of every edge POST. */
  headers() {
    const h = { Authorization: `Bearer ${this.cfg.key}`, 'Content-Type': 'application/json' };
    if (this.cfg.appId) h['X-Watchtower-App-Id'] = this.cfg.appId;
    return h;
  }

  /** Never prints the key. */
  toString() { return `Watchtower(${this.cfg.service} key=${maskKey(this.cfg.key)} ${this.native ? 'native' : 'js'})`; }

  record(type, name, attrs, value, ids) {
    if (this.consent !== 'granted') return;
    try {
      let e = {
        id: newId(), ts_ns: this.now() * 1e6, type, name,
        attrs: safeAttrs({ ...this.context, ...attrs, 'session.id': this.sessionId, ...(this.cfg.dist && { 'app.dist': this.cfg.dist }) }),
      };
      if (value !== undefined) e.value = value;
      const t = ids || this.trace;
      e.trace_id = t.traceId;
      if (t.spanId) e.span_id = t.spanId;
      if (this.cfg.redact) { e = this.cfg.redact(e); if (!e) return; }
      if (e.type === 'error') this.lastErrorId = e.id;
      if (this.native) { this.native.record(JSON.stringify(e)); return; }
      if (this.queue.length >= QUEUE_MAX) this.queue.shift();
      this.queue.push(e);
      if (this.queue.length >= FLUSH_EVENTS) this.flush(); else this.schedule();
    } catch (err) {
      if (this.cfg.debug) console.warn('[watchtower]', String(err));
    }
  }

  schedule() {
    if (this.timer) return;
    const wait = Math.max(FLUSH_MS, this.retryAt - this.now());
    this.timer = setTimeout(() => { this.timer = null; this.flush(); }, wait);
    if (this.timer && this.timer.unref) this.timer.unref();
  }

  breadcrumb(category, message, data) {
    if (this.consent !== 'granted') return;
    this.crumbs.push({ ts: this.now(), category, message: String(message).slice(0, 200), ...(data ? { data } : {}) });
    if (this.crumbs.length > CRUMBS_MAX) this.crumbs.shift();
  }

  /** JSON of the newest breadcrumbs that fit one attribute (2048 chars); never cut mid-JSON. */
  crumbsJson() {
    let c = this.crumbs;
    let s = JSON.stringify(c);
    while (s.length > 2000 && c.length > 1) { c = c.slice(1); s = JSON.stringify(c); }
    return c.length ? s : undefined;
  }

  async flush() {
    if (this.consent !== 'granted') return;
    if (this.native) { try { this.native.flush(); } catch (_) { /* ignore */ } return; }
    if (!this.fetch || !this.queue.length || this.now() < this.retryAt) return;
    if (this.userP) await this.userP;
    const events = this.queue.splice(0, 200);
    const body = {
      session_id: this.sessionId, sent_at_ns: this.now() * 1e6, sdk: SDK,
      app: { service: this.cfg.service, ...(this.cfg.release && { release: this.cfg.release }), ...(this.cfg.dist && { dist: this.cfg.dist }), ...(this.cfg.environment && { env: this.cfg.environment }) },
      page: { url: `app://${this.cfg.service}` }, device: { ua: 'react-native' }, user: this.userHash ? { id_hash: this.userHash } : {}, attrs: {}, events,
    };
    try {
      const res = await this.fetch(`${this.cfg.endpoint}/v1/rum/events`, {
        method: 'POST', headers: { ...this.headers(), 'x-wt-internal': '1' },
        body: JSON.stringify(body),
      });
      if (res.ok) { this.failures = 0; }
      else if (res.status === 429 || res.status >= 500) {
        if (res.status === 429) this.warnOnce('quota', 'rate limit or quota reached (HTTP 429): events are retried with backoff and dropped when the queue is full');
        this.retry(events);
      } else {
        // other 4xx: the batch is invalid for good, retrying cannot help
        this.warnOnce('refused', `events were refused by the edge (HTTP ${res.status}) and dropped; check the key, its app ids and the SDK version`);
      }
    } catch (_) {
      this.retry(events);
    }
    if (this.queue.length) this.schedule();
  }

  retry(events) {
    this.queue.unshift(...events);
    if (this.queue.length > QUEUE_MAX) this.queue.splice(0, this.queue.length - QUEUE_MAX);
    this.failures++;
    this.retryAt = this.now() + Math.min(60000, 1000 * 2 ** Math.min(this.failures, 6)) * (0.5 + Math.random() / 2);
  }

  close() {
    for (const c of this.cleanups.splice(0)) { try { c(); } catch (_) { /* ignore */ } }
    if (this.timer) clearTimeout(this.timer);
  }
}

const get = () => client;
function setClient(c) { if (client) client.close(); client = c; return c; }

module.exports = { Client, get, setClient, SDK, DEFAULT_ENDPOINT };
