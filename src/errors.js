'use strict';
const { get } = require('./client');

function describe(err) {
  if (err && typeof err === 'object') {
    return { type: err.name || (err.constructor && err.constructor.name) || 'Error', message: String(err.message ?? err), stack: String(err.stack || '') };
  }
  return { type: 'NonError', message: String(err), stack: '' };
}

/** Record a JS error with the active trace and span ids and the recent breadcrumbs. Never throws. */
function captureException(err, ctx) {
  const c = get();
  if (!c) return;
  const d = describe(err);
  const handled = !(ctx && ctx['crash.handled'] === false);
  c.record('error', d.type, {
    ...ctx,
    'error.message': d.message, 'error.stack': d.stack.slice(0, 8000), 'error.type': d.type,
    'crash.handled': handled, 'error.source': 'js',
    breadcrumbs: c.crumbsJson(),
  });
  // A fatal JS error is about to kill the app: push it out now (native buffer is already durable).
  if (!handled) c.flush();
}

function captureMessage(message, attrs) {
  const c = get();
  if (c) c.record('error', 'message', { ...attrs, 'error.message': String(message), 'crash.handled': true, 'error.source': 'js' });
}

/** Chains the previous global handler so RedBox / default fatal behaviour is unchanged. */
function installGlobalHandlers(c, g = globalThis) {
  const eu = g.ErrorUtils;
  if (eu && eu.setGlobalHandler) {
    const prev = eu.getGlobalHandler && eu.getGlobalHandler();
    eu.setGlobalHandler((error, isFatal) => {
      captureException(error, { 'crash.handled': !isFatal, 'error.fatal': !!isFatal });
      if (prev) prev(error, isFatal);
    });
    c.cleanups.push(() => prev && eu.setGlobalHandler(prev));
  }
  try {
    const tracking = g.__wtRejectionTracking || require('promise/setimmediate/rejection-tracking');
    tracking.enable({
      allRejections: true,
      onUnhandled: (_id, error) => captureException(error, { 'error.mechanism': 'unhandledrejection', 'crash.handled': false }),
    });
    c.cleanups.push(() => tracking.disable && tracking.disable());
  } catch (_) { /* promise polyfill absent: skip */ }
}

module.exports = { captureException, captureMessage, installGlobalHandlers, describe };
