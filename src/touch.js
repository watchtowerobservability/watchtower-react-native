'use strict';
const { get } = require('./client');

/** Label of the touched element: nearest `wt-label`, `testID` or `accessibilityLabel` walking up the React fiber.
 * Text content is never read, so typed input and user data cannot leak into breadcrumbs. */
function labelFromTouch(event) {
  let f = (event && event._targetInst) || null;
  for (let i = 0; f && i < 20; i++, f = f.return) {
    const p = f.memoizedProps;
    if (p) {
      const l = p['wt-label'] || p.testID || p.accessibilityLabel;
      if (typeof l === 'string' && l) return l;
    }
  }
  return null;
}

const RAGE_TAPS = 3;
const RAGE_MS = 1000;
let taps = [];

/** Breadcrumb for every tap; 3 taps on one label within a second is a `frustration` event. */
function onTouch(event, now = Date.now()) {
  const c = get();
  if (!c) return;
  const label = labelFromTouch(event);
  if (!label) return;
  c.breadcrumb('touch', label);
  taps = taps.filter((t) => now - t.at < RAGE_MS && t.label === label);
  taps.push({ label, at: now });
  if (taps.length >= RAGE_TAPS) {
    c.record('frustration', 'rage_tap', { 'ui.label': label, 'ui.taps': taps.length });
    taps = [];
  }
}

module.exports = { labelFromTouch, onTouch };
