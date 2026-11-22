import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { testMessage } from "@/lib/push";
import { checkRateLimit } from "@/lib/ratelimit";
import { notebookOwner, sameOrigin } from "@/lib/researchServer";
import { sendTelegram, telegramConfig, telegramStore } from "@/lib/telegramServer";

const headers = { "Cache-Control": "private, no-store" };
const fail = (error: string, status: number) => NextResponse.json({ ok: false, error }, { status, headers });

/** Sends a test message to this beta label's Telegram chats (a few per 10 minutes). */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return fail("forbidden", 403);
  const owner = await notebookOwner(await cookies());
  if (!owner) return fail("beta_required", 401);
  const config = telegramConfig();
  const store = telegramStore();
  if (!config || !store) return fail("not_configured", 503);
  const limit = await checkRateLimit("push", owner);
  if (!limit.ok) return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429, headers: { ...headers, "Retry-After": String(limit.retryAfter) } });
  try {
    const r = await sendTelegram(owner, (t) => [testMessage(t)], { store, config });
    return NextResponse.json({ ok: true, data: { devices: r.devices - r.gone, sent: r.sent }, fetchedAt: new Date().toISOString() }, { headers });
  } catch (e) {
    console.error(JSON.stringify({ event: "telegram_test_error", message: e instanceof Error ? e.message : String(e) }));
    return fail("upstream", 502);
  }
}
