import type { ComponentType, ReactNode, Component } from 'react';

export interface ReplayOptions {
  enabled?: boolean;
  /** Mask every label and input (default true). */
  maskText?: boolean;
}

export interface RumEvent {
  id: string;
  ts_ns: number;
  type: 'view' | 'vital' | 'error' | 'resource' | 'action' | 'longtask' | 'journey' | 'frustration' | 'flag' | 'nav';
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
  /** Default true. */
  captureErrors?: boolean;
  network?: boolean;
  stalls?: boolean;
  /** Set false when the native SDK is started from AppDelegate / Application for earlier crash capture. */
  startNative?: boolean;
  debug?: boolean;
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
export function close(): void;
export function instrumentNavigation(ref: NavigationRefLike): { onReady(): void; unsubscribe(): void };
export function trackRoute(name: string, params?: object): void;
export function useExpoRouterTracking(): void;
export function withRenderSpan<P>(Component: ComponentType<P>, name?: string): ComponentType<P>;
export const WatchtowerTouchBoundary: ComponentType<{ children?: ReactNode }>;
export class ErrorBoundary extends Component<{ fallback?: ReactNode; children?: ReactNode }> {}
