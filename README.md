# @watchtowerobservability/react-native

Errors, navigation, touch breadcrumbs and performance spans for React Native and Expo. The JS layer
bridges to the native Watchtower [iOS](https://github.com/watchtowerobservability/watchtower-ios) and
[Android](https://github.com/watchtowerobservability/watchtower-android) SDKs for crashes, hangs/ANRs,
masked replay and the durable offline buffer. Without the native module (Expo Go, web) it falls back to a
JS transport against the same `/v1/rum/events` endpoint.

## Install

```sh
echo '@watchtowerobservability:registry=https://npm.pkg.github.com' >> .npmrc
npm install @watchtowerobservability/react-native
cd ios && pod install
```

GitHub Packages needs a token with `read:packages`; the release tarball installs without one.

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

## Source maps

```sh
WT_API_KEY=<secret api key> wt-rn-sourcemaps --bundle index.android.bundle --map metro.map \
  --hermes-map index.android.bundle.hbc.map --api https://api.example.com --project shop --release 1.4.0
```

The secret key comes from the environment only. Use the same `release` in `init`.

## Provenance

`gh attestation verify <file> --repo watchtowerobservability/watchtower-react-native`

## License

Apache-2.0. Source of truth is the Watchtower monorepo; this repository is a published mirror.
