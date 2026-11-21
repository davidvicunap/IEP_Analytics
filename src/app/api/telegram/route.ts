import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { parseLang } from "@/lib/push";
import { notebookOwner, sameOrigin } from "@/lib/researchServer";
import { linkUrl } from "@/lib/telegram";
import { ensureWebhook, telegramConfig, telegramStore } from "@/lib/telegramServer";

const headers = { "Cache-Control": "private, no-store" };
const fail = (error: string, status: number) => NextResponse.json({ ok: false, error }, { status, headers });

export interface TelegramStatus {
  /** False when this server has no bot: the channel isn't offered. */
  configured: boolean;
  linked: boolean;
}

export async function GET() {
  const owner = await notebookOwner(await cookies());
  if (!owner) return fail("beta_required", 401);
  const config = telegramConfig();
  const store = telegramStore();
  if (!config || !store) return NextResponse.json({ ok: true, data: { configured: false, linked: false } satisfies TelegramStatus, fetchedAt: new Date().toISOString() }, { headers });
  try {
    const chats = await store.chats(owner);
    return NextResponse.json({ ok: true, data: { configured: true, linked: chats.length > 0 } satisfies TelegramStatus, fetchedAt: new Date().toISOString() }, { headers });
  } catch (e) {
    console.error(JSON.stringify({ event: "telegram_status_error", message: e instanceof Error ? e.message : String(e) }));
    return fail("upstream", 502);
  }
}

/** A one-time link that opens the bot and links that chat to this beta label: `{ lang }`. */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return fail("forbidden", 403);
  const owner = await notebookOwner(await cookies());
  if (!owner) return fail("beta_required", 401);
  const config = telegramConfig();
  const store = telegramStore();
  if (!config || !store) return fail("not_configured", 503);
  const body = (await request.json().catch(() => null)) as { lang?: unknown } | null;
  try {
    await ensureWebhook(config);
    const code = await store.createCode(owner, parseLang(body?.lang), new Date());
    return NextResponse.json({ ok: true, data: { url: linkUrl(config.username, code) }, fetchedAt: new Date().toISOString() }, { headers });
  } catch (e) {
    console.error(JSON.stringify({ event: "telegram_link_error", message: e instanceof Error ? e.message : String(e) }));
    return fail("upstream", 502);
  }
}

/** Unlinks every Telegram chat of this beta label. */
export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return fail("forbidden", 403);
  const owner = await notebookOwner(await cookies());
  if (!owner) return fail("beta_required", 401);
  const store = telegramStore();
  if (!telegramConfig() || !store) return fail("not_configured", 503);
  try {
    await store.unlinkOwner(owner);
    return NextResponse.json({ ok: true, data: { linked: false }, fetchedAt: new Date().toISOString() }, { headers });
  } catch (e) {
    console.error(JSON.stringify({ event: "telegram_unlink_error", message: e instanceof Error ? e.message : String(e) }));
    return fail("upstream", 502);
  }
}
