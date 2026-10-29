#!/usr/bin/env node
'use strict';
// Uploads a React Native / Hermes source map. Same request shape as `wtctl sourcemaps upload`.
//   wt-rn-sourcemaps --bundle index.android.bundle --map metro.map [--hermes-map out.hbc.map]
//                    --api https://api.example.com --project my-project [--release 1.2.3+45] [--dist 45]
// Secret API key from WT_API_KEY (never a flag, so it stays out of process lists and CI logs).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) throw new Error(`unexpected argument ${argv[i]}`);
    const k = argv[i].slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    o[k] = argv[++i];
    if (o[k] === undefined) throw new Error(`--${argv[i - 1].slice(2)} needs a value`);
  }
  return o;
}

/** Hermes bytecode maps point at the .hbc; compose them with the Metro map so frames resolve to source. */
function composeMaps(metroMap, hermesMap, run = execFileSync, tool) {
  tool = tool || require.resolve('react-native/scripts/compose-source-maps.js', { paths: [process.cwd()] });
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wt-rn-')), 'composed.map');
  run(process.execPath, [tool, metroMap, hermesMap, '-o', out], { stdio: 'inherit' });
  return out;
}

function release(o, env, run = execFileSync) {
  if (o.release) return o.release;
  if (env.WT_RELEASE) return env.WT_RELEASE;
  try { return run('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch (_) { return ''; }
}

async function upload(o, env = process.env, opts = {}) {
  const key = env.WT_API_KEY || '';
  if (!key) throw new Error('WT_API_KEY (secret API key) is required to upload source maps');
  if (key.startsWith('wtp_')) throw new Error('refusing to upload with a publishable key; use a secret API key');
  for (const r of ['bundle', 'map', 'api', 'project']) if (!o[r]) throw new Error(`--${r} is required`);
  const file = o.hermesMap ? composeMaps(o.map, o.hermesMap, opts.run, opts.composeTool) : o.map;
  const q = new URLSearchParams({ kind: 'sourcemap', name: o.bundle });
  const rel = release(o, env, opts.run);
  if (rel) q.set('release', rel);
  if (o.dist) q.set('dist', o.dist);
  const f = opts.fetch || fetch;
  const url = `${o.api.replace(/\/+$/, '')}/v1/projects/${encodeURIComponent(o.project)}/artifacts?${q}`;
  const res = await f(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/octet-stream', 'Content-Encoding': 'gzip' },
    body: zlib.gzipSync(fs.readFileSync(file)),
  });
  if (!res.ok) throw new Error(`${o.bundle}: HTTP ${res.status}`);
  return { name: o.bundle, release: rel, url };
}

module.exports = { parseArgs, upload, composeMaps };

if (require.main === module) {
  const o = parseArgs(process.argv.slice(2));
  const env = process.env;
  o.api = o.api || env.WT_API_URL;
  o.project = o.project || env.WT_PROJECT;
  upload(o).then((r) => console.log(`watchtower: uploaded ${r.name}${r.release ? ` (release ${r.release})` : ''}`))
    .catch((e) => { console.error(`watchtower: ${e.message}`); process.exit(o.failOnError === 'false' ? 0 : 1); });
}
