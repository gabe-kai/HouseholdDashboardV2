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
const isDisplayPath =
  pathname === "/display" || pathname.startsWith("/display/");

const rootEl = document.getElementById("root")!;

/** Tiny loading shell so member App never mounts/fetches before display probe. */
rootEl.replaceChildren();
const probe = document.createElement("div");
probe.dataset.testid = "boot-probe";
probe.className = "boot-probe";
probe.setAttribute("role", "status");
probe.textContent = "Loading…";
rootEl.appendChild(probe);

async function probeDisplaySession(): Promise<boolean> {
  try {
    const response = await fetch("/api/v1/display/session", {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    return response.ok;
  } catch {
    return false;
  }
}

void (async () => {
  const displaySessionActive = await probeDisplaySession();
  // Active display session always mounts DisplayApp (path-traps to /display).
  // Without a display session, only /display* mounts DisplayApp.
  const mountDisplay = displaySessionActive || isDisplayPath;
  createRoot(rootEl).render(
    <StrictMode>
      {mountDisplay ? <DisplayApp /> : <App />}
    </StrictMode>,
  );
})();
