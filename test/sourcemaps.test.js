'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { upload, parseArgs } = require('../scripts/upload-sourcemaps');
const withWatchtower = require('../plugin/withWatchtower');

function mapFile() {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wtrn-')), 'm.map');
  fs.writeFileSync(p, '{"version":3}');
  return p;
}

test('parseArgs maps flags to camelCase', () => {
  expect(parseArgs(['--bundle', 'a', '--hermes-map', 'h'])).toEqual({ bundle: 'a', hermesMap: 'h' });
  expect(() => parseArgs(['--bundle'])).toThrow();
});

test('upload posts a gzipped map with bearer key, release and dist', async () => {
  const f = jest.fn(() => Promise.resolve({ ok: true, status: 200 }));
  const map = mapFile();
  await upload({ bundle: 'index.android.bundle', map, api: 'https://api.x/', project: 'p 1', release: '1.0', dist: '7' },
    { WT_API_KEY: 'wts_secret' }, { fetch: f });
  const [url, init] = f.mock.calls[0];
  expect(url).toBe('https://api.x/v1/projects/p%201/artifacts?kind=sourcemap&name=index.android.bundle&release=1.0&dist=7');
  expect(init.headers.Authorization).toBe('Bearer wts_secret');
  expect(zlib.gunzipSync(init.body).toString()).toBe('{"version":3}');
});

test('upload refuses a missing or publishable key and surfaces HTTP errors', async () => {
  const o = { bundle: 'b', map: mapFile(), api: 'https://api.x', project: 'p', release: 'r' };
  await expect(upload(o, {})).rejects.toThrow(/WT_API_KEY/);
  await expect(upload(o, { WT_API_KEY: 'wtp_pub' })).rejects.toThrow(/publishable/);
  await expect(upload(o, { WT_API_KEY: 'k' }, { fetch: () => Promise.resolve({ ok: false, status: 403 }) })).rejects.toThrow(/403/);
});

test('hermes map is composed first', async () => {
  const run = jest.fn((_n, args) => fs.writeFileSync(args[args.indexOf('-o') + 1], '{"composed":1}'));
  const f = jest.fn(() => Promise.resolve({ ok: true }));
  await upload({ bundle: 'b', map: mapFile(), hermesMap: mapFile(), api: 'https://a', project: 'p', release: 'r' }, { WT_API_KEY: 'k' }, { fetch: f, run, composeTool: '/rn/compose.js' });
  expect(zlib.gunzipSync(f.mock.calls[0][1].body).toString()).toBe('{"composed":1}');
});

test('expo plugin needs a publishable key and exposes it in extra', () => {
  expect(() => withWatchtower({}, { key: 'wts_x' })).toThrow(/publishable/);
  const out = withWatchtower({ slug: 'shop' }, { key: 'wtp_x', endpoint: 'https://e' });
  expect(out.extra.watchtower).toEqual({ key: 'wtp_x', endpoint: 'https://e', service: 'shop', environment: undefined });
});

test('gradle and ios snippets never contain a key', () => {
  const up = { api: 'https://a', project: 'p' };
  for (const s of [withWatchtower.gradleSnippet(up), withWatchtower.iosPhase(up)]) {
    expect(s).toContain('upload-sourcemaps.js');
    expect(s).not.toMatch(/wt[ps]_/);
  }
});
