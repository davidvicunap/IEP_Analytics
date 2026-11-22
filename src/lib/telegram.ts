// Alerts on Telegram, the pure part: reading what the bot receives (/start with a one-time
// code links a chat to a beta label; /stop unlinks it) and writing alert messages as Telegram
// HTML with a button that opens the page. Sending lives in telegramServer.ts.
import type { PushMessage } from "./push";

export interface Incoming {
  chatId: string;
  /** "start" with its code, "stop", or anything else. */
  command: { kind: "start"; code: string | null } | { kind: "stop" } | { kind: "other" };
  /** The user's Telegram language, when it says. */
  lang: "es" | "en" | null;
}

/** A webhook update from Telegram, or null when it isn't a private text message. */
export function parseUpdate(raw: unknown): Incoming | null {
  const m = (raw as { message?: { chat?: { id?: unknown; type?: unknown }; text?: unknown; from?: { language_code?: unknown } } } | null)?.message;
  if (!m || typeof m.text !== "string" || (typeof m.chat?.id !== "number" && typeof m.chat?.id !== "string")) return null;
  if (m.chat.type !== undefined && m.chat.type !== "private") return null;
  const text = m.text.trim();
  const lc = typeof m.from?.language_code === "string" ? m.from.language_code.slice(0, 2) : null;
  const lang = lc === "es" ? "es" : lc === "en" ? "en" : null;
  const start = text.match(/^\/start(?:@\w+)?(?:\s+([A-Za-z0-9_-]{6,64}))?$/);
  if (start) return { chatId: String(m.chat.id), command: { kind: "start", code: start[1] ?? null }, lang };
  if (/^\/stop(?:@\w+)?$/.test(text)) return { chatId: String(m.chat.id), command: { kind: "stop" }, lang };
  return { chatId: String(m.chat.id), command: { kind: "other" }, lang };
}

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The message body for Telegram (HTML mode) and its button, with the page as an absolute link. */
export function telegramMessage(m: PushMessage, siteUrl: string, open: string): { text: string; reply_markup: { inline_keyboard: { text: string; url: string }[][] } } {
  const url = new URL(m.url, siteUrl);
  url.searchParams.set("src", "alert");
  return {
    text: `<b>${escape(m.title)}</b>\n${escape(m.body)}`,
    reply_markup: { inline_keyboard: [[{ text: open, url: url.toString() }]] },
  };
}

/** A one-time code for the "Connect Telegram" link (fits Telegram's /start parameter). */
export function newLinkCode(random: () => string = () => crypto.randomUUID()): string {
  return random().replace(/-/g, "").slice(0, 24);
}

/** The deep link that opens the bot with the code. */
export const linkUrl = (botUsername: string, code: string) => `https://t.me/${encodeURIComponent(botUsername)}?start=${encodeURIComponent(code)}`;
