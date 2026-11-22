'use strict';
const wt = require('../src');

const KEY = 'wtp_test_not_real';
const quiet = { captureErrors: false, network: false, stalls: false, fetch: () => Promise.resolve({ ok: true, status: 202 }) };

afterEach(() => wt.close());

test('the native crash-loop guard reaches JS with the threshold handed to native start', async () => {
  const started = [];
  const native = {
    record() {},
    start(o) { started.push(o); },
    crashLoop: () => Promise.resolve({ launchCrashCount: 3, isCrashLooping: true }),
  };
  wt.init({ key: KEY, native, crashLoopThreshold: 3, ...quiet });
  expect(started[0].crashLoopThreshold).toBe(3);
  await expect(wt.crashLoop()).resolves.toEqual({ launchCrashCount: 3, isCrashLooping: true });
});

test('without the native module, or when it fails, the guard reports no loop', async () => {
  await expect(wt.crashLoop()).resolves.toEqual({ launchCrashCount: 0, isCrashLooping: false });
  wt.init({ key: KEY, native: null, ...quiet });
  await expect(wt.crashLoop()).resolves.toEqual({ launchCrashCount: 0, isCrashLooping: false });
  wt.init({ key: KEY, native: { record() {}, crashLoop: () => Promise.reject(new Error('x')) }, ...quiet });
  await expect(wt.crashLoop()).resolves.toEqual({ launchCrashCount: 0, isCrashLooping: false });
});

test('native options reach the native start call', () => {
  const started = [];
  const native = { record() {}, start(o) { started.push(o); } };
  wt.init({
    key: KEY, native, tracePropagationTargets: ['https://api.example/'],
    nativeOptions: { trackViews: false, profileLaunch: true, buildId: 'b1', hangThresholdMs: 3000 }, ...quiet,
  });
  expect(started[0]).toMatchObject({
    trackViews: false, trackNetwork: null, profileLaunch: true, buildId: 'b1', hangThresholdMs: 3000,
    propagateTo: ['https://api.example/'],
  });
});
