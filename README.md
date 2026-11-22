# @watchtowerobservability/react-native

Errors, navigation, touch breadcrumbs and performance spans for React Native and Expo. The JS layer
bridges to the native Watchtower [iOS](https://github.com/watchtowerobservability/watchtower-ios) and
[Android](https://github.com/watchtowerobservability/watchtower-android) SDKs for crashes, hangs/ANRs,
masked replay and the durable offline buffer. Without the native module (Expo Go, web) it falls back to a
JS transport against the same `/v1/rum/events` endpoint.

## Install

```sh
npm install @watchtowerobservability/react-native
cd ios && pod install
```

The native Android SDK resolves from Maven Central and the iOS SDK from CocoaPods trunk; no token is needed.

## Quick start

```js
import * as wt from '@watchtowerobservability/react-native';
wt.init({ key: 'wtp_...', endpoint: 'https://edge.example.com', service: 'shop', release: '1.4.0' });
// React Navigation:  const nav = wt.instrumentNavigation(navigationRef);  <NavigationContainer onReady={nav.onReady} />
// Expo Router:       wt.useExpoRouterTracking();   (once, in the root layout)
// Touches:           <wt.WatchtowerTouchBoundary><App /></wt.WatchtowerTouchBoundary>
```

Expo: add `["@watchtowerobservability/react-native", { "key": "wtp_...", "endpoint": "...", "uploadSourceMaps": { "api": "https://api.example.com", "project": "shop" } }]`
to `plugins`, then read `Constants.expoConfig.extra.watchtower` and pass it to `init`.

## Integrations

| Area | What you get |
| --- | --- |
| JS errors | `ErrorUtils` global handler (chained, RedBox unchanged), unhandled promise rejections, `ErrorBoundary`, `captureException`, `captureMessage`; trace and span ids, last 50 breadcrumbs attached |
| Navigation | React Navigation (`instrumentNavigation`), Expo Router (`useExpoRouterTracking`, route pattern not concrete path); `nav` + `view` events, new trace per screen; param values are never sent, only keys |
| Touch | Tap breadcrumbs from `wt-label` / `testID` / `accessibilityLabel` (never text), rage-tap `frustration` events |
| Performance | `startSpan`, `reportAppReady` (app-start vital), JS stall `longtask` events, `fetch` resource events with optional W3C `traceparent` (`tracePropagationTargets`), `withRenderSpan` |
| Native | Crashes, hangs/ANR, replay (`replay: { enabled, maskText }`), offline buffer via the iOS and Android SDKs |
| Source maps | `wt-rn-sourcemaps` CLI composes Metro + Hermes maps and uploads them; Expo plugin wires iOS and Android release builds |

## Configuration

| Option / env | Meaning |
| --- | --- |
| `key` | Publishable ingest key (`wtp_...`); secret keys are refused. Sent as `Authorization: Bearer`, masked in any string output, never logged |
| `endpoint` / `WT_OTLP_ENDPOINT` | Default `http://localhost:4318` |
| `service` / `WT_SERVICE` | Service name |
| `environment` / `WT_ENVIRONMENT` | Deployment environment |
| `release` / `WT_RELEASE` | Release, must match the source map upload |
| `redact(event)` | Edit or drop (return `null`) any event before it leaves JS |
| `startNative: false` | Use when the native SDK is already started from `AppDelegate` / `Application` for earlier crash capture |
| `captureErrors`, `network`, `stalls` | Set `false` to turn a feature off |

Incoming `wt.*` attributes are removed (the gateway deletes them anyway). Delivery is at-least-once.

## App id

The SDK sends the app id as `X-Watchtower-App-Id`: the `appId` option, else the bundle id / package name from the native module. An app sends no `Origin`, so add the iOS bundle id and the Android package name to the publishable key's **app ids** (Settings, Browser keys) or the edge refuses events and feedback with 403 `app_id_not_allowed`.

## User feedback

```js
const ok = await Watchtower.feedback({ message: 'The checkout button does nothing', name: 'Ann', email: 'ann@example.com' });
```

It is linked to the last error the SDK recorded (or pass `eventId`) and posted from JS, with or
without the native SDK. Name and email become pseudonyms at the edge. Resolves `false` when nothing
was accepted; never throws.

Crash-loop guard: the native iOS and Android SDKs detect launch crashes and tag them
(`crash.launch`); a JS fatal ends the process through the native handler, so it counts too. Read
the guard from JS to enter a safe mode (threshold: `crashLoopThreshold`, default 2):

```js
const { isCrashLooping } = await Watchtower.crashLoop();
if (isCrashLooping) { /* skip the risky start-up work, offer a reset */ }
```

## Source maps

```sh
WT_API_KEY=<secret api key> wt-rn-sourcemaps --bundle index.android.bundle --map metro.map \
  --hermes-map index.android.bundle.hbc.map --api https://api.example.com --project shop --release 1.4.0
```

The secret key comes from the environment only. Use the same `release` in `init`.

### Over-the-air updates (`expo export` / `eas update`)

Frames of an OTA bundle symbolicate against that update's map: upload it with release = app version and dist = the update id. The SDK reports `dist` from `expo-updates` (`Updates.updateId`) on its own.

```sh
npx expo export --source-maps
WT_API_KEY=<secret api key> npx wt-rn-sourcemaps --expo-export dist --update-id "$UPDATE_ID" \
  --api https://api.example.com --project shop --release 1.4.0
```

With EAS, run the second command right after `eas update` (the group id in its JSON output is the update id; `--release` defaults to `dist/expoConfig.json` `version`). In CI: `eas update --json --non-interactive | tee update.json` then pass the update id from it. Native builds keep using the Gradle / Xcode hooks the Expo plugin adds.

## User, consent and stop

`setUser({ id })` sends a salted hash (never the id). `init({ consent: 'pending' })` captures nothing until `setConsent('granted')`; `setConsent('denied')` or `stop()` removes native crash capture and clears queues now, and the denial persists across launches until `setConsent('granted')` (or an explicit `consent: 'granted'` in `init`).

## Provenance

`gh attestation verify <file> --repo watchtowerobservability/watchtower-react-native`

## License

Apache-2.0. Source of truth is the Watchtower monorepo; this repository is a published mirror.
