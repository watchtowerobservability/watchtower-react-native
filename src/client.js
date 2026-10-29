'use strict';
const { newId, newTraceId, newSpanId, safeAttrs, maskKey } = require('./util');

const SDK = { name: 'watchtower.react-native', version: '0.1.0' };
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
    };
    this.fetch = o.fetch || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    this.native = o.native === undefined ? loadNative() : o.native;
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
    if (this.native && o.startNative !== false && typeof this.native.start === 'function') {
      const { key, service, endpoint, environment, release, replay } = this.cfg;
      try { this.native.start({ key, service, endpoint, environment, release, replay: replay || null }); } catch (_) { /* native start is best effort */ }
    }
  }

  /** Never prints the key. */
  toString() { return `Watchtower(${this.cfg.service} key=${maskKey(this.cfg.key)} ${this.native ? 'native' : 'js'})`; }

  record(type, name, attrs, value, ids) {
    try {
      let e = {
        id: newId(), ts_ns: this.now() * 1e6, type, name,
        attrs: safeAttrs({ ...this.context, ...attrs, 'session.id': this.sessionId }),
      };
      if (value !== undefined) e.value = value;
      const t = ids || this.trace;
      e.trace_id = t.traceId;
      if (t.spanId) e.span_id = t.spanId;
      if (this.cfg.redact) { e = this.cfg.redact(e); if (!e) return; }
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
    if (this.native) { try { this.native.flush(); } catch (_) { /* ignore */ } return; }
    if (!this.fetch || !this.queue.length || this.now() < this.retryAt) return;
    const events = this.queue.splice(0, 200);
    const body = {
      session_id: this.sessionId, sent_at_ns: this.now() * 1e6, sdk: SDK,
      app: { service: this.cfg.service, ...(this.cfg.release && { release: this.cfg.release }), ...(this.cfg.environment && { env: this.cfg.environment }) },
      page: { url: `app://${this.cfg.service}` }, device: { ua: 'react-native' }, user: {}, attrs: {}, events,
    };
    try {
      const res = await this.fetch(`${this.cfg.endpoint}/v1/rum/events`, {
        method: 'POST', headers: { Authorization: `Bearer ${this.cfg.key}`, 'Content-Type': 'application/json', 'x-wt-internal': '1' },
        body: JSON.stringify(body),
      });
      if (res.ok) { this.failures = 0; }
      else if (res.status === 429 || res.status >= 500) this.retry(events);
      // other 4xx: the batch is invalid for good, retrying cannot help
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
