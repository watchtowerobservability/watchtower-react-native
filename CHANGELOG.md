# Changelog

## 0.1.0

- JS error capture (global handler, unhandled rejections, error boundary) with trace/span ids and breadcrumbs.
- Navigation tracking for React Navigation and Expo Router; touch breadcrumbs and rage-tap detection.
- Performance: manual spans, fetch resource events with optional `traceparent`, JS stall detection, app-ready vital, render spans.
- Native bridge to the Watchtower iOS and Android SDKs (crashes, hangs/ANR, replay, offline buffer).
- Expo config plugin and Hermes source map upload (`wt-rn-sourcemaps`).
