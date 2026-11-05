import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { initializeModelSettings } from "./lib/model-settings";
import "./styles.css";
import "./styles-panels.css";
import "./styles-projects.css";
import "./components/chat.css";
import "./workspace-layout.css";
const initialSettings = initializeModelSettings();
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App initialSettings={initialSettings} />
  </React.StrictMode>,
);
