'use strict';
const { Client, get, setClient } = require('./client');
const errors = require('./errors');
const perf = require('./perf');
const nav = require('./navigation');
const { sendFeedback } = require('./feedback');

/** Start Watchtower. Call once, as early as possible (top of index.js). Returns the client; never throws on a bad runtime, only on a missing key. */
function init(options) {
  const c = setClient(new Client(options));
  nav.resetNavigationState();
  const o = options || {};
  if (o.captureErrors !== false) errors.installGlobalHandlers(c);
  if (o.network !== false) perf.installNetwork(c);
  if (o.stalls !== false) perf.installStallDetector(c);
  return c;
}

const lazy = () => require('./components');

module.exports = {
  init,
  captureException: errors.captureException,
  captureMessage: errors.captureMessage,
  addBreadcrumb(category, message, data) { const c = get(); if (c) c.breadcrumb(category, message, data); },
  /** Attributes added to every later event (not `wt.*`). */
  setContext(attrs) { const c = get(); if (c) c.context = { ...c.context, ...attrs }; },
  startSpan: perf.startSpan,
  reportAppReady: perf.reportAppReady,
  flush() { const c = get(); return c ? c.flush() : Promise.resolve(); },
  /** User feedback linked to `eventId`, by default the last error recorded; resolves false when not accepted (never throws). */
  feedback(f) { const c = get(); return c ? sendFeedback(c, f) : Promise.resolve(false); },
  /** Consecutive launch crashes and whether the app is crash looping (enter a safe mode); never throws. */
  crashLoop() { const c = get(); return c ? c.crashLoop() : Promise.resolve({ launchCrashCount: 0, isCrashLooping: false }); },
  close() { setClient(null); },
  instrumentNavigation: nav.instrumentNavigation,
  trackRoute: nav.trackRoute,
  useExpoRouterTracking: nav.useExpoRouterTracking,
  get WatchtowerTouchBoundary() { return lazy().WatchtowerTouchBoundary; },
  get withRenderSpan() { return lazy().withRenderSpan; },
  get ErrorBoundary() { return lazy().ErrorBoundary; },
};
