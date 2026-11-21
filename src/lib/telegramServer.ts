// Alerts on Telegram, server side. Needs a bot (made with @BotFather): TELEGRAM_BOT_TOKEN and
// TELEGRAM_BOT_USERNAME. Without them the channel is simply not offered. The webhook is registered
// the first time someone asks for a link, with a secret derived from the token so Telegram's calls
// can be told apart from anyone else's. Chats and one-time codes are kept per beta label.
import { createHash } from "node:crypto";
import { and, eq, gt, lt } from "drizzle-orm";
import { getDb, type Db } from "@/db/client";
import { telegramChats, telegramCodes } from "@/db/schema";
import { isDemo } from "./data";
import type { Lang } from "./format";
import type { CoreDict } from "./i18n/es";
import type { PushMessage } from "./push";
import { dictFor, type SendResult } from "./pushServer";
import { newLinkCode, telegramMessage } from "./telegram";

export interface TelegramConfig {
  token: string;
  username: string;
  /** Sent by Telegram with every webhook call (X-Telegram-Bot-Api-Secret-Token). */
  secret: string;
}

/** In demo mode, DEMO_TELEGRAM=1 offers a pretend bot that never calls Telegram (for browser checks). */
export const DEMO_TOKEN = "demo";

export function telegramConfig(env: Record<string, string | undefined> = process.env): TelegramConfig | null {
  if (env.DEMO_TELEGRAM === "1" && !env.TELEGRAM_BOT_TOKEN && isDemo()) return { token: DEMO_TOKEN, username: "iep_demo_bot", secret: "demo-webhook-secret" };
  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  const username = env.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, "");
  if (!token || !username) return null;
  const secret = env.TELEGRAM_WEBHOOK_SECRET?.trim() || createHash("sha256").update(`iep-telegram-webhook:${token}`).digest("hex").slice(0, 48);
  return { token, username, secret };
}

/** The site's public address, for links in messages and the webhook. */
export function siteUrl(env: Record<string, string | undefined> = process.env): string {
  const explicit = env.SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const prod = env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  return prod ? `https://${prod}` : "https://iepanalytics.vercel.app";
}

export interface TelegramStore {
  createCode(owner: string, lang: Lang, now: Date): Promise<string>;
  /** The code's owner and language, once (the code is spent); null when unknown or expired. */
  takeCode(code: string, now: Date): Promise<{ owner: string; lang: Lang } | null>;
  link(chatId: string, owner: string, lang: Lang, now: Date): Promise<void>;
  /** The owner the chat belonged to, if any. */
  unlinkChat(chatId: string): Promise<string | null>;
  unlinkOwner(owner: string): Promise<void>;
  chats(owner: string): Promise<{ chatId: string; lang: Lang }[]>;
}

export const CODE_MINUTES = 15;
const asLang = (v: string): Lang => (v === "en" ? "en" : "es");

export function postgresTelegram(db: Db): TelegramStore {
  return {
    async createCode(owner, lang, now) {
      await db.delete(telegramCodes).where(lt(telegramCodes.expiresAt, now));
      const code = newLinkCode();
      await db.insert(telegramCodes).values({ code, owner, lang, expiresAt: new Date(now.getTime() + CODE_MINUTES * 60_000) });
      return code;
    },
    async takeCode(code, now) {
      const rows = await db.delete(telegramCodes).where(and(eq(telegramCodes.code, code), gt(telegramCodes.expiresAt, now))).returning();
      return rows[0] ? { owner: rows[0].owner, lang: asLang(rows[0].lang) } : null;
    },
    async link(chatId, owner, lang, now) {
      await db.insert(telegramChats).values({ chatId, owner, lang, linkedAt: now }).onConflictDoUpdate({ target: telegramChats.chatId, set: { owner, lang, linkedAt: now } });
    },
    async unlinkChat(chatId) {
      const rows = await db.delete(telegramChats).where(eq(telegramChats.chatId, chatId)).returning({ owner: telegramChats.owner });
      return rows[0]?.owner ?? null;
    },
    async unlinkOwner(owner) {
      await db.delete(telegramChats).where(eq(telegramChats.owner, owner));
    },
    async chats(owner) {
      const rows = await db.select().from(telegramChats).where(eq(telegramChats.owner, owner));
      return rows.map((r) => ({ chatId: r.chatId, lang: asLang(r.lang) }));
    },
  };
}

export function memoryTelegram(): TelegramStore {
  const codes = new Map<string, { owner: string; lang: Lang; expires: number }>();
  const chats = new Map<string, { owner: string; lang: Lang }>();
  return {
    async createCode(owner, lang, now) {
      const code = newLinkCode();
      codes.set(code, { owner, lang, expires: now.getTime() + CODE_MINUTES * 60_000 });
      return code;
    },
    async takeCode(code, now) {
      const c = codes.get(code);
      codes.delete(code);
      return c && c.expires > now.getTime() ? { owner: c.owner, lang: c.lang } : null;
    },
    async link(chatId, owner, lang) {
      chats.set(chatId, { owner, lang });
    },
    async unlinkChat(chatId) {
      const c = chats.get(chatId);
      chats.delete(chatId);
      return c?.owner ?? null;
    },
    async unlinkOwner(owner) {
      for (const [id, c] of chats) if (c.owner === owner) chats.delete(id);
    },
    async chats(owner) {
      return [...chats].filter(([, c]) => c.owner === owner).map(([chatId, c]) => ({ chatId, lang: c.lang }));
    },
  };
}

let demo: TelegramStore | null = null;
export function telegramStore(): TelegramStore | null {
  const db = getDb();
  if (db) return postgresTelegram(db);
  if (isDemo()) return (demo ??= memoryTelegram());
  return null;
}

/** Calls the Bot API; the HTTP status (0: Telegram couldn't be reached). */
export type TelegramApi = (method: string, body: Record<string, unknown>) => Promise<{ status: number; description?: string }>;

/** What the demo bot "sent" (newest last). */
export const demoSent: { method: string; body: Record<string, unknown> }[] = [];

export function botApi(config: TelegramConfig): TelegramApi {
  if (config.token === DEMO_TOKEN) {
    return async (method, body) => {
      demoSent.push({ method, body });
      return { status: 200 };
    };
  }
  return async (method, body) => {
    try {
      const res = await fetch(`https://api.telegram.org/bot${config.token}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const json = (await res.json().catch(() => null)) as { description?: string } | null;
      return { status: res.status, description: json?.description };
    } catch {
      return { status: 0 };
    }
  };
}

let webhookSet: string | null = null;
/** Points the bot at this site once per server instance (Telegram keeps it; repeating is harmless). */
export async function ensureWebhook(config: TelegramConfig, api: TelegramApi = botApi(config), site = siteUrl()): Promise<boolean> {
  const url = `${site}/api/telegram/webhook`;
  if (webhookSet === url) return true;
  const r = await api("setWebhook", { url, secret_token: config.secret, allowed_updates: ["message"], drop_pending_updates: false });
  if (r.status >= 200 && r.status < 300) {
    webhookSet = url;
    return true;
  }
  console.warn(JSON.stringify({ event: "telegram_webhook_failed", status: r.status }));
  return false;
}

/** Sends `build(lang)` to every chat linked to `owner`. A chat that blocked the bot (403) is unlinked. */
export async function sendTelegram(owner: string, build: (t: CoreDict, lang: Lang) => PushMessage[], deps: { store: TelegramStore; config: TelegramConfig; api?: TelegramApi; site?: string }): Promise<SendResult> {
  const { store, config, api = botApi(config), site = siteUrl() } = deps;
  const chats = await store.chats(owner);
  const out: SendResult = { devices: chats.length, sent: 0, failed: 0, gone: 0 };
  for (const c of chats) {
    const t = dictFor(c.lang);
    for (const m of build(t, c.lang)) {
      const r = await api("sendMessage", { chat_id: c.chatId, parse_mode: "HTML", disable_web_page_preview: true, ...telegramMessage(m, site, t.telegram.open) });
      if (r.status === 403) {
        await store.unlinkChat(c.chatId);
        out.gone++;
        break;
      }
      if (r.status >= 200 && r.status < 300) out.sent++;
      else {
        out.failed++;
        console.warn(JSON.stringify({ event: "telegram_send_failed", status: r.status }));
      }
    }
  }
  return out;
}
