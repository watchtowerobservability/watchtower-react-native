import type { ComponentType, ReactNode, Component } from 'react';

export interface ReplayOptions {
  enabled?: boolean;
  /** Mask every label and input (default true). */
  maskText?: boolean;
  /** `screenshot` (default) or `wireframe`: the view hierarchy with masked text and image placeholders, no pixels. */
  mode?: 'screenshot' | 'wireframe';
}

export interface RumEvent {
  id: string;
  ts_ns: number;
  type: 'view' | 'vital' | 'error' | 'resource' | 'action' | 'longtask' | 'journey' | 'frustration' | 'flag' | 'nav' | 'db' | 'storage';
  name: string;
  value?: number;
  attrs: Record<string, string | number | boolean>;
  trace_id?: string;
  span_id?: string;
}

export interface InitOptions {
  /** Publishable ingest key. Secret keys are refused. */
  key: string;
  /** Edge base URL; defaults to WT_OTLP_ENDPOINT or http://localhost:4318. */
  endpoint?: string;
  service?: string;
  environment?: string;
  release?: string;
  /** Last chance to edit or drop (return null) an event. Runs before native hand-off. */
  redact?: (e: RumEvent) => RumEvent | null;
  replay?: ReplayOptions;
  /** Add a W3C `traceparent` header to fetches whose URL matches (string contains, or RegExp). */
  tracePropagationTargets?: Array<string | RegExp>;
  /**
   * iOS bundle id / Android package name sent as `X-Watchtower-App-Id`; must be on the publishable
   * key's app ids. Defaults to the native module's value.
   */
  appId?: string;
  /** `crashLoop().isCrashLooping` is true from this many consecutive launch crashes (native default 2). */
  crashLoopThreshold?: number;
  /** Passed to the native SDK: native views/resources, hang threshold, launch profiling, build id, propagateTo. */
  nativeOptions?: {
    trackViews?: boolean;
    trackNetwork?: boolean;
    hangThresholdMs?: number;
    profileLaunch?: boolean;
    buildId?: string;
    propagateTo?: string[];
  };
  /** Default true. */
  captureErrors?: boolean;
  network?: boolean;
  stalls?: boolean;
  /** Set false when the native SDK is started from AppDelegate / Application for earlier crash capture. */
  startNative?: boolean;
  debug?: boolean;
  /**
   * `pending`: nothing is captured or sent until `setConsent('granted')`. Unset: granted, unless a denial persisted
   * by `stop()` / `setConsent('denied')` is still in force natively. `'granted'` lifts that persisted denial.
   */
  consent?: 'granted' | 'pending' | 'denied';
  /** Update id reported as `dist` so frames symbolicate against the OTA bundle's map; default `expo-updates` `updateId`. */
  dist?: string;
}

export interface Feedback {
  message: string;
  name?: string;
  email?: string;
  /** Error event this is about; default: the last error the SDK recorded. */
  eventId?: string;
}

export interface Span {
  traceId: string;
  spanId: string;
  end(attrs?: Record<string, string | number | boolean>): void;
}

export interface NavigationRefLike {
  addListener(event: 'state', cb: () => void): () => void;
  getCurrentRoute(): { name: string; params?: object } | undefined;
  isReady?(): boolean;
}

export class Client {
  toString(): string;
}

export function init(options: InitOptions): Client;
export function captureException(err: unknown, attrs?: Record<string, string | number | boolean>): void;
export function captureMessage(message: string, attrs?: Record<string, string | number | boolean>): void;
export function addBreadcrumb(category: string, message: string, data?: object): void;
export function setContext(attrs: Record<string, string | number | boolean>): void;
export function startSpan(name: string, attrs?: Record<string, string | number | boolean>): Span;
export function reportAppReady(): void;
export function flush(): Promise<void>;
/** Sends user feedback to the edge; resolves false when it was not accepted (never throws). */
export function feedback(f: Feedback): Promise<boolean>;
export interface CrashLoopState {
  /** Consecutive launches that crashed within 5 s, counted by the native SDK. */
  launchCrashCount: number;
  isCrashLooping: boolean;
}
/** The native crash-loop guard; zeros without the native module. Never throws. */
export function crashLoop(): Promise<CrashLoopState>;
export function close(): void;
/** Attach a user to every batch as a salted SHA-256 hash (the raw id never leaves the device); `null` clears. */
export function setUser(user: ({ id: string } & Record<string, unknown>) | null): void;
/** `denied` stops capture now (same as `stop()`), `granted` resumes. */
export function setConsent(consent: 'granted' | 'denied'): void;
/** Uninstall native crash capture, delete the native crash buffer, clear timers and queues; persisted until granted. */
export function stop(): void;
export function instrumentNavigation(ref: NavigationRefLike): { onReady(): void; unsubscribe(): void };
export function trackRoute(name: string, params?: object): void;
export function useExpoRouterTracking(): void;

/** Client storage options: calls at or over `slowMs` (default 100) are reported; synchronous ones use 16 ms (one frame). */
export interface StoreOptions {
  /** `db.namespace`, e.g. the database file name */
  name?: string;
  slowMs?: number;
}
/** Wrap your own module or instance in place (returned for chaining); slow or failed calls become `db` events. */
export function instrumentAsyncStorage<T extends object>(storage: T, o?: Omit<StoreOptions, 'name'>): T;
export function instrumentMMKV<T extends object>(mmkv: T, o?: StoreOptions): T;
/** op-sqlite, quick-sqlite, nitro-sqlite and expo-sqlite handles. Records the operation and first table only. */
export function instrumentSQLite<T extends object>(db: T, o?: StoreOptions): T;
export function instrumentWatermelon<T extends object>(database: T, o?: StoreOptions): T;
export function instrumentRealm<T extends object>(realm: T, o?: StoreOptions): T;
/** A store's on-disk size in bytes (read with your file-system module), sent as `wt.embedded.file_size`. */
export function recordStoreSize(system: string, bytes: number, o?: { namespace?: string; walBytes?: number }): void;
export function withRenderSpan<P>(Component: ComponentType<P>, name?: string): ComponentType<P>;
export const WatchtowerTouchBoundary: ComponentType<{ children?: ReactNode }>;
export class ErrorBoundary extends Component<{ fallback?: ReactNode; children?: ReactNode }> {}
