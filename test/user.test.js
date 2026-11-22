'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const wt = require('../src');
const { sha256Hex } = require('../src/sha256');
const { expoBundles, uploadExpoExport } = require('../scripts/upload-sourcemaps');

const KEY = 'wtp_test_not_real';
function start(extra = {}, respond) {
  const sent = [];
  const fetch = jest.fn((url, init) => {
    if (url.endsWith('/v1/rum/config')) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ id_salt: 'pepper' }) });
    sent.push(JSON.parse(init.body));
    return Promise.resolve(respond ? respond() : { ok: true, status: 202 });
  });
  const c = wt.init({ key: KEY, endpoint: 'http://edge', native: null, fetch, captureErrors: false, network: false, stalls: false, ...extra });
  return { c, sent, fetch };
}
afterEach(() => { wt.close(); jest.restoreAllMocks(); });

test('sha256Hex matches node:crypto, including multibyte and block-edge input', () => {
  for (const s of ['', 'abc', 'pepper:user-1', 'é€😀', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64), 'x'.repeat(200)]) {
    expect(sha256Hex(s)).toBe(crypto.createHash('sha256').update(s).digest('hex'));
  }
});

test('setUser sends the salted hash in the batch user field; null clears', async () => {
  const { sent } = start();
  wt.setUser({ id: 'u1', email: 'a@b.c' });
  wt.captureMessage('a');
  await wt.flush();
  expect(sent[0].user).toEqual({ id_hash: crypto.createHash('sha256').update('pepper:u1').digest('hex') });
  expect(JSON.stringify(sent[0])).not.toContain('u1"');
  wt.setUser(null);
  wt.captureMessage('b');
  await wt.flush();
  expect(sent[1].user).toEqual({});
});

test('pending sends nothing until granted; denied and stop clear queue and stop native', async () => {
  const native = { start: jest.fn(), record: jest.fn(), flush: jest.fn(), stop: jest.fn() };
  const { sent } = start({ consent: 'pending', native });
  expect(native.start).not.toHaveBeenCalled();
  wt.captureMessage('held');
  await wt.flush();
  expect(sent).toHaveLength(0);
  expect(native.record).not.toHaveBeenCalled();
  wt.setConsent('granted');
  expect(native.start).toHaveBeenCalledWith(expect.objectContaining({ consent: 'granted' }));
  wt.captureMessage('now');
  expect(native.record).toHaveBeenCalledTimes(1);
  wt.stop();
  expect(native.stop).toHaveBeenCalledTimes(1);
  wt.captureMessage('after');
  expect(native.record).toHaveBeenCalledTimes(1);
});

test('stop empties the JS queue and cancels the flush timer', async () => {
  const { c, sent } = start();
  wt.captureMessage('queued');
  expect(c.queue).toHaveLength(1);
  wt.stop();
  expect(c.queue).toHaveLength(0);
  expect(c.timer).toBeNull();
  await wt.flush();
  expect(sent).toHaveLength(0);
});

test('a denial persisted natively holds at init unless consent is explicit', () => {
  const mk = () => ({ stopped: true, start: jest.fn(), record: jest.fn(), flush: jest.fn(), stop: jest.fn() });
  let native = mk();
  start({ native });
  expect(native.start).not.toHaveBeenCalled();
  wt.close();
  native = mk();
  start({ native, consent: 'granted' });
  expect(native.start).toHaveBeenCalledWith(expect.objectContaining({ consent: 'granted' }));
});

test('warns once on a refused batch and once on 429', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  let status = 422;
  start({}, () => ({ ok: false, status }));
  for (let i = 0; i < 2; i++) { wt.captureMessage('x'); await wt.flush(); }
  expect(warn).toHaveBeenCalledTimes(1);
  expect(warn.mock.calls[0][0]).toMatch(/refused.*422/);
  status = 429;
  const c = require('../src/client').get();
  for (let i = 0; i < 2; i++) { c.retryAt = 0; wt.captureMessage('y'); await wt.flush(); }
  expect(warn).toHaveBeenCalledTimes(2);
  expect(warn.mock.calls[1][0]).toMatch(/429/);
});

test('dist is reported on the batch and events', async () => {
  const { sent } = start({ dist: 'upd-1' });
  wt.captureMessage('d');
  await wt.flush();
  expect(sent[0].app.dist).toBe('upd-1');
  expect(sent[0].events[0].attrs['app.dist']).toBe('upd-1');
});

test('expo export: finds per-platform bundles with maps and uploads under release and update id', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wtexp-'));
  for (const p of ['ios', 'android']) {
    const d = path.join(dir, '_expo/static/js', p);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'entry-1.hbc'), 'b');
    fs.writeFileSync(path.join(d, 'entry-1.hbc.map'), '{"version":3}');
  }
  fs.writeFileSync(path.join(dir, '_expo/static/js/ios/nomap.js'), 'x');
  fs.writeFileSync(path.join(dir, 'expoConfig.json'), '{"version":"1.4.0"}');
  expect(expoBundles(dir).map((b) => b.platform)).toEqual(['ios', 'android']);
  const f = jest.fn(() => Promise.resolve({ ok: true, status: 200 }));
  await uploadExpoExport({ expoExport: dir, updateId: 'u-9', api: 'https://api.x', project: 'p' }, { WT_API_KEY: 'wts_s' }, { fetch: f });
  expect(f).toHaveBeenCalledTimes(2);
  expect(f.mock.calls[0][0]).toBe('https://api.x/v1/projects/p/artifacts?kind=sourcemap&name=entry-1.hbc&release=1.4.0&dist=u-9');
  await expect(uploadExpoExport({ expoExport: dir, api: 'a', project: 'p' }, {}, {})).rejects.toThrow(/update-id/);
});
