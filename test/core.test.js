'use strict';
const wt = require('../src');
const { installGlobalHandlers } = require('../src/errors');
const { onTouch, labelFromTouch } = require('../src/touch');
const { routePattern } = require('../src/navigation');
const { installNetwork } = require('../src/perf');

const KEY = 'wtp_test_not_real';
const ok = () => Promise.resolve({ ok: true, status: 202 });

function start(extra = {}) {
  const sent = [];
  const fetch = jest.fn((url, init) => { sent.push({ url, init, body: JSON.parse(init.body) }); return ok(); });
  const c = wt.init({ key: KEY, service: 'shop', endpoint: 'http://edge:4318/', native: null, fetch, captureErrors: false, network: false, stalls: false, ...extra });
  return { c, sent, fetch };
}

afterEach(() => wt.close());

test('refuses a missing or secret key', () => {
  expect(() => wt.init({})).toThrow(/key/);
  expect(() => wt.init({ key: 'wts_secret' })).toThrow(/publishable/);
});

test('key is masked in string output', () => {
  const { c } = start();
  expect(String(c)).not.toContain(KEY);
  expect(String(c)).toContain('wtp_...');
});

test('batches events with bearer key, drops wt.* attrs, adds trace ids', async () => {
  const { sent } = start();
  wt.captureException(new Error('boom'), { 'wt.tenant_id': 'x', plan: 'pro' });
  await wt.flush();
  expect(sent).toHaveLength(1);
  expect(sent[0].url).toBe('http://edge:4318/v1/rum/events');
  expect(sent[0].init.headers.Authorization).toBe(`Bearer ${KEY}`);
  const e = sent[0].body.events[0];
  expect(e.type).toBe('error');
  expect(e.attrs['error.message']).toBe('boom');
  expect(e.attrs.plan).toBe('pro');
  expect(Object.keys(e.attrs).some((k) => k.startsWith('wt.'))).toBe(false);
  expect(e.trace_id).toMatch(/^[0-9a-f]{32}$/);
  expect(sent[0].body.app.service).toBe('shop');
});

test('redact can drop or edit', async () => {
  const { sent } = start({ redact: (e) => (e.type === 'error' ? null : e) });
  wt.captureException(new Error('x'));
  wt.trackRoute('Home');
  await wt.flush();
  expect(sent[0].body.events.map((e) => e.type)).toEqual(['nav']);
});

test('native module gets the event instead of the JS transport', async () => {
  const native = { start: jest.fn(), record: jest.fn(), flush: jest.fn() };
  const { fetch } = start({ native });
  expect(native.start).toHaveBeenCalledWith(expect.objectContaining({ key: KEY, service: 'shop' }));
  wt.captureMessage('hi');
  await wt.flush();
  expect(JSON.parse(native.record.mock.calls[0][0]).name).toBe('message');
  expect(fetch).not.toHaveBeenCalled();
  expect(native.flush).toHaveBeenCalled();
});

test('5xx keeps the batch for retry, 4xx drops it', async () => {
  let status = 503;
  const fetch = jest.fn(() => Promise.resolve({ ok: false, status }));
  const c = wt.init({ key: KEY, native: null, fetch, captureErrors: false, network: false, stalls: false });
  wt.captureMessage('a');
  await c.flush();
  expect(c.queue).toHaveLength(1);
  c.retryAt = 0;
  status = 422;
  await c.flush();
  expect(c.queue).toHaveLength(0);
});

test('queue is bounded at 500', () => {
  const { c } = start();
  c.retryAt = Date.now() + 1e9; // never flush
  for (let i = 0; i < 600; i++) c.record('action', 'a', {});
  expect(c.queue.length).toBe(500);
});

test('breadcrumbs ride on errors and stay valid JSON', async () => {
  const { sent } = start();
  for (let i = 0; i < 80; i++) wt.addBreadcrumb('touch', `button-${i}-${'x'.repeat(100)}`);
  wt.captureException(new Error('e'));
  await wt.flush();
  const raw = sent[0].body.events[0].attrs.breadcrumbs;
  expect(raw.length).toBeLessThanOrEqual(2048);
  const crumbs = JSON.parse(raw);
  expect(crumbs[crumbs.length - 1].message).toContain('button-79');
});

test('global handler captures fatal errors and chains the previous handler', async () => {
  const { c, sent } = start();
  const prev = jest.fn();
  let installed;
  const g = { ErrorUtils: { getGlobalHandler: () => prev, setGlobalHandler: (h) => { installed = h; } }, __wtRejectionTracking: { enable: jest.fn() } };
  installGlobalHandlers(c, g);
  installed(new Error('fatal'), true);
  expect(prev).toHaveBeenCalled();
  await new Promise((r) => setImmediate(r));
  const e = sent[0].body.events[0];
  expect(e.attrs['crash.handled']).toBe(false);
  expect(g.__wtRejectionTracking.enable).toHaveBeenCalled();
});

test('navigation: nav event, view duration for previous screen, new trace per route', async () => {
  const { c, sent } = start();
  wt.trackRoute('Home');
  const t1 = c.trace.traceId;
  wt.trackRoute('Home'); // same route: ignored
  wt.trackRoute('Cart', { id: 'secret-123' });
  expect(c.trace.traceId).not.toBe(t1);
  await wt.flush();
  const ev = sent[0].body.events;
  expect(ev.map((e) => `${e.type}:${e.name}`)).toEqual(['nav:Home', 'view:Home', 'nav:Cart']);
  expect(ev[2].attrs['nav.param_keys']).toBe('id');
  expect(JSON.stringify(ev)).not.toContain('secret-123');
});

test('instrumentNavigation listens to state changes', () => {
  start();
  let cb;
  const unsub = jest.fn();
  const ref = { addListener: (_e, f) => { cb = f; return unsub; }, getCurrentRoute: () => ({ name: 'A' }), isReady: () => false };
  const h = wt.instrumentNavigation(ref);
  expect(typeof h.onReady).toBe('function');
  cb();
  wt.close();
  expect(unsub).toHaveBeenCalled();
});

test('expo router pattern drops groups and keeps dynamic segments unresolved', () => {
  expect(routePattern(['(tabs)', 'user', '[id]'], '/user/42')).toBe('/user/[id]');
  expect(routePattern([], '/')).toBe('/');
});

test('touch: label from fiber, rage tap becomes frustration', async () => {
  const { sent } = start();
  const ev = { _targetInst: { memoizedProps: {}, return: { memoizedProps: { testID: 'buy-btn' }, return: null } } };
  expect(labelFromTouch(ev)).toBe('buy-btn');
  expect(labelFromTouch({})).toBeNull();
  onTouch(ev, 1000); onTouch(ev, 1200); onTouch(ev, 1400);
  await wt.flush();
  expect(sent[0].body.events.map((e) => e.name)).toEqual(['rage_tap']);
});

test('spans: end emits one action with duration and trace ids', async () => {
  const { sent } = start();
  const s = wt.startSpan('checkout', { items: 3 });
  s.end(); s.end();
  await wt.flush();
  const evs = sent[0].body.events;
  expect(evs).toHaveLength(1);
  expect(evs[0]).toMatchObject({ type: 'action', name: 'checkout', span_id: s.spanId });
});

test('network: records fetch, strips query, traceparent only for targets, skips own endpoint', async () => {
  const calls = [];
  const g = { fetch: jest.fn((u, i) => { calls.push(i); return Promise.resolve({ status: 200 }); }) };
  const { c, sent } = start({ tracePropagationTargets: ['api.shop.test'] });
  installNetwork(c, g);
  await g.fetch('https://api.shop.test/cart?token=abc');
  await g.fetch('https://other.test/x');
  await g.fetch('http://edge:4318/v1/rum/events');
  expect(calls[0].headers.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  expect(calls[1]).toBeUndefined();
  await wt.flush();
  const evs = sent[0].body.events;
  expect(evs).toHaveLength(2);
  expect(evs[0].attrs['http.url']).toBe('https://api.shop.test/cart');
});
