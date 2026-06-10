import './index.css';
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import SpotlightBar from "./components/SpotlightBar";

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
    {windowParam === 'spotlight' ? <SpotlightBar /> :
     windowParam === 'browser'   ? <BrowserWindowShim /> :
     <App />}
  </React.StrictMode>,
);
