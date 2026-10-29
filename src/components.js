'use strict';
// React-dependent pieces, required lazily by index.js so the rest runs under plain node.
const { get } = require('./client');
const { onTouch } = require('./touch');

/** Wrap the app root: `<WatchtowerTouchBoundary><App /></WatchtowerTouchBoundary>`. Records tap breadcrumbs
 * and rage-tap frustration without changing layout or swallowing touches (capture phase, no responder). */
function WatchtowerTouchBoundary({ children }) {
  const React = require('react');
  const { View } = require('react-native');
  return React.createElement(View, { style: { flex: 1 }, onTouchEndCapture: onTouch }, children);
}

/** Render timing as a span per commit: `export default withRenderSpan(Screen, 'Checkout')`. */
function withRenderSpan(Component, name) {
  const React = require('react');
  const label = name || Component.displayName || Component.name || 'Component';
  function Wrapped(props) {
    return React.createElement(
      React.Profiler,
      { id: label, onRender: (_id, phase, actual) => { const c = get(); if (c) c.record('action', `render ${label}`, { 'render.phase': phase }, actual); } },
      React.createElement(Component, props),
    );
  }
  Wrapped.displayName = `withRenderSpan(${label})`;
  return Wrapped;
}

/** Error boundary that reports and renders `fallback`. */
function makeErrorBoundary() {
  const React = require('react');
  const { captureException } = require('./errors');
  return class WatchtowerErrorBoundary extends React.Component {
    constructor(p) { super(p); this.state = { failed: false }; }
    static getDerivedStateFromError() { return { failed: true }; }
    componentDidCatch(error, info) { captureException(error, { 'error.mechanism': 'react.boundary', 'react.component_stack': (info && info.componentStack || '').slice(0, 2000) }); }
    render() { return this.state.failed ? (this.props.fallback || null) : this.props.children; }
  };
}

let boundary;
module.exports = {
  WatchtowerTouchBoundary,
  withRenderSpan,
  get ErrorBoundary() { return boundary || (boundary = makeErrorBoundary()); },
};
