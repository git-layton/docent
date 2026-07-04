import './index.css';
import { applyTheme, DEFAULT_ACCENT, DEFAULT_THEME } from './lib/theme';
import React, { Component } from "react";
import type { ReactNode } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import SpotlightBar from "./components/SpotlightBar";
import GlowOverlay from "./components/GlowOverlay";

// ---------------------------------------------------------------------------
// Root error boundary — turns white-screen crashes into readable diagnostics
// ---------------------------------------------------------------------------
class RootErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    const { error } = this.state;
    if (error) {
      return (
        <div style={{ padding: '2rem', background: '#0a0b0e', color: '#ff6b6b', height: '100vh', fontFamily: 'monospace', overflow: 'auto' }}>
          <div style={{ fontSize: '18px', marginBottom: '1rem' }}>⚠️ App crashed — {error.message}</div>
          <pre style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', whiteSpace: 'pre-wrap', marginBottom: '1.5rem' }}>
            {error.stack}
          </pre>
          <button
            onClick={() => this.setState({ error: null })}
            style={{ padding: '0.5rem 1.5rem', background: '#4A5D75', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px' }}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// Stamp theme attributes before first paint; settings hydrate() re-applies saved prefs.
applyTheme(DEFAULT_THEME, DEFAULT_ACCENT);

const windowParam = new URLSearchParams(window.location.search).get('window');

function BrowserWindowShim() {
  React.useEffect(() => {
    import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
      getCurrentWindow().close().catch(() => {});
    });
  }, []);
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100vh', background: '#0a0b0e', color: 'rgba(255,255,255,0.5)',
      fontFamily: 'system-ui', fontSize: '14px'
    }}>
      Browser is now a tab in the main window. Closing...
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <RootErrorBoundary>
      {windowParam === 'spotlight' ? <SpotlightBar /> :
       windowParam === 'glow'      ? <GlowOverlay /> :
       windowParam === 'browser'   ? <BrowserWindowShim /> :
       <App />}
    </RootErrorBoundary>
  </React.StrictMode>,
);
