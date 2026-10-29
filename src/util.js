'use strict';
// Shared helpers. No React Native imports here so jest can run everything under plain node.

const HEX = '0123456789abcdef';
function hex(n) {
  let s = '';
  for (let i = 0; i < n; i++) s += HEX[Math.floor(Math.random() * 16)];
  return s;
}
const newId = () => `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`;
const newTraceId = () => hex(32);
const newSpanId = () => hex(16);

/** The gateway deletes `wt.*`, so they are dropped here; long keys and strings are cut to the wire limits. */
function safeAttrs(a) {
  const out = {};
  for (const k of Object.keys(a || {})) {
    if (k.startsWith('wt.') || k.length > 128) continue;
    const v = a[k];
    if (v === undefined || v === null) continue;
    out[k] = typeof v === 'string' && v.length > 2048 ? v.slice(0, 2048) : v;
  }
  return out;
}

function maskKey(key) {
  return key ? `${String(key).slice(0, 4)}...` : '';
}

/** Strip query and fragment: URLs often carry tokens. */
function cleanUrl(u) {
  return String(u).split('#')[0].split('?')[0];
}

module.exports = { newId, newTraceId, newSpanId, safeAttrs, maskKey, cleanUrl };
