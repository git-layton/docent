import './index.css';
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import SpotlightBar from "./components/SpotlightBar";
import BrowserWindowApp from "./BrowserWindowApp";

const windowParam = new URLSearchParams(window.location.search).get('window');

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {windowParam === 'spotlight' ? <SpotlightBar /> :
     windowParam === 'browser'   ? <BrowserWindowApp /> :
     <App />}
  </React.StrictMode>,
);
