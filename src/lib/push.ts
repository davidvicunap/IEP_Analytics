// Phone alerts (Web Push), the pure part: what a browser subscription must look like to be
// stored, and the notification text for newly fired thesis alerts or a test. Sending lives in
// pushServer.ts; the browser side in pushClient.ts.
import type { Lang } from "./format";
import type { CoreDict } from "./i18n/es";
import { fill } from "./i18n/fill";
import type { Signal, SignalKind } from "./thesis";
import { alertText } from "./thesisText";

export interface PushSub {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

const B64URL = /^[A-Za-z0-9_-]+={0,2}$/;

/** A subscription from the network, or null when it isn't one a push service would accept. */
export function parseSubscription(raw: unknown): PushSub | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  const { endpoint } = r;
  if (typeof endpoint !== "string" || endpoint.length > 1000) return null;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const p256dh = r.keys?.p256dh;
  const auth = r.keys?.auth;
  if (typeof p256dh !== "string" || !B64URL.test(p256dh) || p256dh.length < 40 || p256dh.length > 200) return null;
  if (typeof auth !== "string" || !B64URL.test(auth) || auth.length < 8 || auth.length > 64) return null;
  return { endpoint, keys: { p256dh, auth } };
}

export const parseLang = (v: unknown): Lang => (v === "en" ? "en" : "es");

export interface PushMessage {
  title: string;
  body: string;
  /** The page a tap opens (always a path on this site). */
  url: string;
  /** Notifications with the same tag replace each other (one per stock). */
  tag: string;
}

/** Above this many stocks in one check, one summary notification instead of one per stock. */
export const MAX_STOCK_NOTIFICATIONS = 3;
const MAX_LINES = 3;

/** The notifications for alerts that just fired, grouped by stock. */
export function alertMessages(fired: { symbol: string; alerts: Signal[] }[], t: CoreDict, lang: Lang): PushMessage[] {
  const P = t.push;
  const withAlerts = fired.filter((f) => f.alerts.length > 0);
  if (withAlerts.length > MAX_STOCK_NOTIFICATIONS) {
    return [{ title: fill(P.msgTheses, { n: withAlerts.length }), body: withAlerts.map((f) => f.symbol).join(" · "), url: "/", tag: "theses" }];
  }
  return withAlerts.map(({ symbol, alerts }) => {
    const lines = alerts.slice(0, MAX_LINES).map((a) => alertText(a, t.thesis, lang));
    if (alerts.length > MAX_LINES) lines.push("…");
    return {
      title: alerts.length === 1 ? fill(P.msgOne, { s: symbol }) : fill(P.msgMany, { s: symbol, n: alerts.length }),
      body: lines.join("\n"),
      url: `/stock/${encodeURIComponent(symbol)}?tab=research`,
      tag: `thesis-${symbol}`,
    };
  });
}

/** After the close: the holdings and theses we couldn't check today, and with what data. */
export function uncheckedMessage(list: { symbol: string; kinds: SignalKind[] }[], t: CoreDict): PushMessage[] {
  if (!list.length) return [];
  const names = t.thesis.uncheckedNames;
  const body = list
    .slice(0, 6)
    .map((x) => `${x.symbol}: ${[...new Set(x.kinds.map((k) => names[k]))].join(", ")}`)
    .join(" · ");
  return [{ title: t.push.msgUncheckedTitle, body: `${body}${list.length > 6 ? " …" : ""}\n${t.push.msgUncheckedNext}`, url: "/", tag: "unchecked" }];
}

export function testMessage(t: CoreDict): PushMessage {
  return { title: t.push.msgTestTitle, body: t.push.msgTestBody, url: "/", tag: "test" };
}
