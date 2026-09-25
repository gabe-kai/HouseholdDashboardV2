import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { DisplayApp } from "./DisplayApp";
import "./styles.css";

if (import.meta.env.DEV) {
  // Compact Local development indicator (badge + top stripe); same warm theme as release.
  document.documentElement.dataset.appEnv = "development";
}

const pathname = window.location.pathname;
const isDisplay =
  pathname === "/display" || pathname.startsWith("/display/");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {isDisplay ? <DisplayApp /> : <App />}
  </StrictMode>,
);
