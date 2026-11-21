import { NextResponse } from "next/server";
import { parseUpdate } from "@/lib/telegram";
import { botApi, telegramConfig, telegramStore } from "@/lib/telegramServer";
import { dictFor } from "@/lib/pushServer";

/**
 * Telegram calls this for every message to the bot (open past the beta gate: Telegram has no
 * session). Only calls carrying our secret are read. /start CODE links the chat to the beta label
 * that asked for the code; /stop unlinks it. Always answers 200 so Telegram doesn't retry.
 */
export async function POST(request: Request) {
  const config = telegramConfig();
  const store = telegramStore();
  if (!config || !store) return NextResponse.json({ ok: false }, { status: 404 });
  if (request.headers.get("x-telegram-bot-api-secret-token") !== config.secret) return NextResponse.json({ ok: false }, { status: 401 });
  const update = parseUpdate(await request.json().catch(() => null));
  if (!update) return NextResponse.json({ ok: true });
  const api = botApi(config);
  const reply = (text: string) => api("sendMessage", { chat_id: update.chatId, text });
  try {
    const now = new Date();
    if (update.command.kind === "start") {
      const taken = update.command.code ? await store.takeCode(update.command.code, now) : null;
      const t = dictFor(taken?.lang ?? update.lang ?? "es");
      if (!taken) await reply(t.telegram.botExpired);
      else {
        await store.link(update.chatId, taken.owner, taken.lang, now);
        await reply(t.telegram.botLinked);
      }
    } else if (update.command.kind === "stop") {
      await store.unlinkChat(update.chatId);
      await reply(dictFor(update.lang ?? "es").telegram.botStopped);
    } else {
      await reply(dictFor(update.lang ?? "es").telegram.botHelp);
    }
  } catch (e) {
    console.error(JSON.stringify({ event: "telegram_webhook_error", message: e instanceof Error ? e.message : String(e) }));
  }
  return NextResponse.json({ ok: true });
}
