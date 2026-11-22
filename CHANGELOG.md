# Changelog

## 0.2.1

- Native Android dependency from Maven Central (`io.github.watchtowerobservability:watchtower-android:0.1.2`), iOS WatchtowerSDK from CocoaPods trunk (`~> 0.1`).

## 0.2.0

- `setUser({ id })` / `setUser(null)`: the id is sent as `user.id_hash`, SHA-256 of `salt:id` with the project salt from `/v1/rum/config`, exactly like the browser SDK; the raw id never leaves the device. (JS transport; with the native module events go through the native SDK's own batches.)
- Consent: `setConsent('granted' | 'denied')`, `stop()` and `consent: 'pending'` at init (nothing captured or sent until granted). `stop()` is immediate: JS timers, queues and breadcrumbs are cleared and the native module's new `stop` method removes the iOS exception and signal handlers (Android: restores the previous JVM uncaught-exception handler), deletes the native crash and offline buffers and persists the denial, so the next launch does not start native capture until `consent: 'granted'` or `setConsent('granted')`. Limit: the Android NDK signal handler has no native uninstall and stays until the process exits.
- Over-the-air updates: `wt-rn-sourcemaps --expo-export <dist> [--update-id <id>]` uploads every `_expo/static/js/{ios,android}` bundle map with release = app version and dist = the update id. At runtime `dist` is `options.dist` or expo-updates `updateId` (optional peer), sent as `app.dist` on the batch and events.
- One-time `console.warn` when the edge refuses events (4xx) or answers 429 (rate limit or quota).
- The pod depends on `WatchtowerSDK ~> 0.1` instead of this package's exact version.

## Unreleased before 0.2.0 (shipped in 0.2.0)

- Client storage: `instrumentAsyncStorage`, `instrumentMMKV`, `instrumentSQLite` (op-sqlite, quick/nitro-sqlite, expo-sqlite), `instrumentWatermelon`, `instrumentRealm` record slow or failed calls as `db` events (synchronous JS-thread work flagged `db.main_thread`); `recordStoreSize` and MMKV `size` as `storage` events. Pass-the-module, no new dependencies.
- `crashLoop()` reads the native crash-loop guard (`launchCrashCount`, `isCrashLooping`); `crashLoopThreshold` option.
- `appId` option (default: the native module's bundle id / package name), sent as `X-Watchtower-App-Id`.
- The pod depends on the native `WatchtowerSDK` pod (was `Watchtower`).
- `feedback({ message, name, email, eventId })` posts user feedback linked to the last error.

## 0.1.0

- JS error capture (global handler, unhandled rejections, error boundary) with trace/span ids and breadcrumbs.
- Navigation tracking for React Navigation and Expo Router; touch breadcrumbs and rage-tap detection.
- Performance: manual spans, fetch resource events with optional `traceparent`, JS stall detection, app-ready vital, render spans.
- Native bridge to the Watchtower iOS and Android SDKs (crashes, hangs/ANR, replay, offline buffer).
- Expo config plugin and Hermes source map upload (`wt-rn-sourcemaps`).
