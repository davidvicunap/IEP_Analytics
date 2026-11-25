"use client";

// Product events from the browser (see lib/funnel.ts): fire and forget, never in the way.
import type { EventName } from "./funnel";

export function track(name: Exclude<EventName, "alert_sent">, props: Record<string, string | number | boolean> = {}): void {
  try {
    fetch("/api/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, props }), keepalive: true }).catch(() => undefined);
  } catch {
    /* measurement must never break the page */
  }
}

const localDay = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** One "visit" per device and day; and "alert_opened" when a notification opened the page. */
export function trackArrival(): void {
  try {
    const day = localDay();
    if (localStorage.getItem("iep.visit") !== day) {
      localStorage.setItem("iep.visit", day);
      track("visit");
    }
  } catch {
    /* blocked storage: no visit count, nothing else changes */
  }
  const url = new URL(window.location.href);
  if (url.searchParams.get("src") === "alert") {
    track("alert_opened");
    url.searchParams.delete("src");
    window.history.replaceState(window.history.state, "", url.pathname + (url.search ? url.search : "") + url.hash);
  }
}
