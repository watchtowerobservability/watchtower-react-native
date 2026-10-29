'use strict';
const { get } = require('./client');
const { newSpanId, cleanUrl } = require('./util');

const bundleStart = Date.now();

/** Manual span. Emits one `action` event with the duration when ended; children inherit the trace. */
function startSpan(name, attrs) {
  const c = get();
  const span = { traceId: c ? c.trace.traceId : '', spanId: newSpanId(), parentSpanId: c ? c.trace.spanId : undefined, started: Date.now(), ended: false };
  span.end = (extra) => {
    if (span.ended || !c) return;
    span.ended = true;
    c.record('action', name, { ...attrs, ...extra, 'parent.span_id': span.parentSpanId }, Date.now() - span.started, span);
  };
  return span;
}

/** Call once the first screen is usable: reports JS-side app start and time to ready. */
function reportAppReady() {
  const c = get();
  if (c) c.record('vital', 'app_start_ready', {}, Date.now() - bundleStart);
}

/** Event-loop stall detector: a timer that fires late means the JS thread was blocked. */
function installStallDetector(c, { intervalMs = 100, thresholdMs = 250, timers = globalThis } = {}) {
  let last = Date.now();
  const id = timers.setInterval(() => {
    const now = Date.now();
    const late = now - last - intervalMs;
    last = now;
    if (late >= thresholdMs) c.record('longtask', 'js_stall', {}, late);
  }, intervalMs);
  if (id && id.unref) id.unref();
  c.cleanups.push(() => timers.clearInterval(id));
}

function matches(url, targets) {
  return targets.some((t) => (t instanceof RegExp ? t.test(url) : String(url).includes(t)));
}

/** Wraps global fetch: one `resource` event per request; `traceparent` only for configured targets. */
function installNetwork(c, g = globalThis) {
  const orig = g.fetch;
  if (typeof orig !== 'function') return;
  g.fetch = function wtFetch(input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    // Our own batches (and anything the app marks internal) are not instrumented, or each flush would add an event.
    if (url.startsWith(c.cfg.endpoint) || (init && init.headers && init.headers['x-wt-internal'])) return orig.call(this, input, init);
    const span = newSpanId();
    const started = Date.now();
    const method = (init && init.method) || 'GET';
    let next = init;
    if (matches(url, c.cfg.tracePropagationTargets)) {
      next = { ...init, headers: { ...(init && init.headers), traceparent: `00-${c.trace.traceId}-${span}-01` } };
    }
    const done = (status, extra) => c.record('resource', 'fetch', { 'http.method': method, 'http.url': cleanUrl(url), 'http.status_code': status, ...extra }, Date.now() - started, { traceId: c.trace.traceId, spanId: span });
    return orig.call(this, input, next).then(
      (res) => { done(res.status); return res; },
      (err) => { done(0, { 'error.message': String(err && err.message) }); throw err; },
    );
  };
  c.cleanups.push(() => { g.fetch = orig; });
}

module.exports = { startSpan, reportAppReady, installStallDetector, installNetwork, bundleStart };
