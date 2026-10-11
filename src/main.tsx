import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { isDemoMode, setupDemoMocks } from "./demo/mockInvoke";

if (isDemoMode()) {
  setupDemoMocks();
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

