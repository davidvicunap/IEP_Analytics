"use client";

// Phone alerts, browser side. What this device can do (and why not), turning alerts on (permission →
// service worker → push subscription → saved to the beta account), off, and a test. The page
// keeps the state; every step here returns a typed result instead of throwing.
import type { PushConfig } from "@/app/api/push/route";
import type { PushTestResult } from "@/app/api/push/test/route";
import type { Lang } from "./format";
import { fetchViewResult, toViewResult, type ViewIssue, type ViewResult } from "./resource";

/** What this device shows: unsupported, iPhone outside the installed app, blocked by the user, off, on. */
export type PushStatus = "unsupported" | "ios" | "denied" | "off" | "on";
/** Why turning alerts on didn't finish: the server's reason, the browser's refusal, or a dismissed prompt. */
export type PushIssue = ViewIssue | "denied" | "dismissed" | "subscribe_failed";

const SW = "/sw.js";

function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}
function installed(): boolean {
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}
const supported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration("/");
  return reg ? reg.pushManager.getSubscription() : null;
}

export async function readPushStatus(): Promise<PushStatus> {
  // iPhone and iPad offer push only inside the installed app (Add to Home Screen).
  if (!supported()) return isIos() && !installed() ? "ios" : "unsupported";
  if (Notification.permission === "denied") return "denied";
  try {
    const sub = await currentSubscription();
    return sub && Notification.permission === "granted" ? "on" : "off";
  } catch {
    return "off";
  }
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
const sameKey = (a: ArrayBuffer | null | undefined, b: Uint8Array) => !!a && a.byteLength === b.byteLength && new Uint8Array(a).every((x, i) => x === b[i]);

async function send<T>(url: string, method: "POST" | "DELETE", body?: unknown): Promise<ViewResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    return { ok: false, error: "upstream" };
  }
  return toViewResult<T>(res.status, await res.json().catch(() => null));
}

/** Asks for permission, subscribes this browser and saves it to the account. */
export async function enablePush(lang: Lang): Promise<{ ok: true } | { ok: false; issue: PushIssue }> {
  const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  if (permission === "denied") return { ok: false, issue: "denied" };
  if (permission !== "granted") return { ok: false, issue: "dismissed" };
  const config = await fetchViewResult<PushConfig>("/api/push");
  if (!config.ok) return { ok: false, issue: config.error };
  let sub: PushSubscription;
  try {
    const key = keyBytes(config.data.publicKey);
    const reg = await navigator.serviceWorker.register(SW, { scope: "/" });
    await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    // A subscription made with another server key can't receive our pushes: replace it.
    if (existing && !sameKey(existing.options.applicationServerKey, key)) await existing.unsubscribe();
    sub = existing && sameKey(existing.options.applicationServerKey, key) ? existing : await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  } catch {
    return { ok: false, issue: "subscribe_failed" };
  }
  const saved = await send<{ saved: boolean }>("/api/push", "POST", { subscription: sub.toJSON(), lang });
  return saved.ok ? { ok: true } : { ok: false, issue: saved.error };
}

/** Re-saves this browser's subscription (in this language) if it has one: the account may have lost it. */
export async function resyncPush(lang: Lang): Promise<void> {
  try {
    const sub = await currentSubscription();
    if (sub) await send("/api/push", "POST", { subscription: sub.toJSON(), lang });
  } catch {
    /* the next visit tries again */
  }
}

/** Stops alerts on this browser: removed from the account, then unsubscribed. */
export async function disablePush(): Promise<{ ok: true } | { ok: false; issue: ViewIssue }> {
  let sub: PushSubscription | null = null;
  try {
    sub = await currentSubscription();
  } catch {
    /* nothing subscribed here */
  }
  if (!sub) return { ok: true };
  const r = await send<{ removed: boolean }>("/api/push", "DELETE", { endpoint: sub.endpoint });
  if (!r.ok) return { ok: false, issue: r.error };
  await sub.unsubscribe().catch(() => false);
  return { ok: true };
}

export async function sendTestPush(): Promise<ViewResult<PushTestResult>> {
  return send<PushTestResult>("/api/push/test", "POST");
}
