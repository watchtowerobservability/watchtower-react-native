'use strict';
const { get } = require('./client');
const { newTraceId, newSpanId } = require('./util');

let current = null; // { name, started }

/** A route change: closes the previous screen as a `view`, starts a new trace, emits a `nav` event.
 * Param values are never recorded (they carry ids and PII), only their keys. */
function trackRoute(name, params) {
  const c = get();
  if (!c || !name) return;
  if (current && current.name === name) return;
  const now = Date.now();
  if (current) c.record('view', current.name, {}, now - current.started, current.ids);
  const ids = { traceId: newTraceId(), spanId: newSpanId() };
  c.trace = ids;
  c.record('nav', name, { 'nav.from': current ? current.name : undefined, 'nav.param_keys': params ? Object.keys(params).join(',') : undefined });
  c.breadcrumb('navigation', name);
  current = { name, started: now, ids };
}

/** React Navigation: `instrumentNavigation(navigationRef)`; call `onReady` from `NavigationContainer` too if the ref is not ready yet. */
function instrumentNavigation(ref) {
  const report = () => {
    const r = ref.getCurrentRoute && ref.getCurrentRoute();
    if (r) trackRoute(r.name, r.params);
  };
  const unsub = ref.addListener('state', report);
  if (ref.isReady && ref.isReady()) report();
  const c = get();
  if (c) c.cleanups.push(unsub);
  return { onReady: report, unsubscribe: unsub };
}

/** Expo Router: call `useExpoRouterTracking()` once in the root layout. Reports the matched route pattern
 * (`/user/[id]`), not the concrete path, so ids stay out of event names. */
function useExpoRouterTracking() {
  const React = require('react');
  const { usePathname, useSegments, useGlobalSearchParams } = require('expo-router');
  const pathname = usePathname();
  const segments = useSegments();
  const params = useGlobalSearchParams();
  React.useEffect(() => { trackRoute(routePattern(segments, pathname), params); }, [pathname]);
}

function routePattern(segments, pathname) {
  const s = (segments || []).filter((x) => !/^\(.*\)$/.test(x)); // drop (group) segments
  return s.length ? `/${s.join('/')}` : pathname || '/';
}

function resetNavigationState() { current = null; }

module.exports = { trackRoute, instrumentNavigation, useExpoRouterTracking, routePattern, resetNavigationState };
