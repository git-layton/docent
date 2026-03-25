import './index.css';
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import SpotlightBar from "./components/SpotlightBar";

const isSpotlight = new URLSearchParams(window.location.search).get('window') === 'spotlight';

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isSpotlight ? <SpotlightBar /> : <App />}
  </React.StrictMode>,
);
