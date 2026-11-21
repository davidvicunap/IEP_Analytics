import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { normalizeSymbol } from "@/lib/data";
import { notebookOwner, sameOrigin } from "@/lib/researchServer";
import { tradeStore } from "@/lib/tradeStore";
import { TRADE_LIMITS, book, parseTradeInput, type Trade } from "@/lib/trades";

const headers = { "Cache-Control": "private, no-store" };
const fail = (error: string, status: number) => NextResponse.json({ ok: false, error }, { status, headers });
const nyToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

/** Every buy and sell this beta label has logged, oldest first. */
export async function GET() {
  const owner = await notebookOwner(await cookies());
  if (!owner) return fail("beta_required", 401);
  const store = tradeStore();
  if (!store) return fail("not_configured", 503);
  try {
    return NextResponse.json({ ok: true, data: await store.list(owner), fetchedAt: new Date().toISOString() }, { headers });
  } catch (e) {
    console.error(JSON.stringify({ event: "trades_error", message: e instanceof Error ? e.message : String(e) }));
    return fail("upstream", 502);
  }
}

/**
 * Logs a buy or sell: `{ symbol, side, date, shares, price, fees?, stop?, note? }`. A sell of
 * more shares than were bought before that date is refused (409 `oversold`).
 */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return fail("forbidden", 403);
  const owner = await notebookOwner(await cookies());
  if (!owner) return fail("beta_required", 401);
  const store = tradeStore();
  if (!store) return fail("not_configured", 503);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const symbol = typeof body?.symbol === "string" ? normalizeSymbol(body.symbol) : null;
  const input = parseTradeInput(body, nyToday());
  if (!symbol || !input) return fail("invalid", 400);
  try {
    const all = await store.list(owner);
    if (all.length >= TRADE_LIMITS.perOwner) return fail("invalid", 400);
    const trade: Trade = { id: crypto.randomUUID().slice(0, 12), symbol, createdAt: new Date().toISOString(), ...input };
    if (book([...all, trade]).oversold.length > book(all).oversold.length) return fail("oversold", 409);
    await store.add(owner, trade);
    return NextResponse.json({ ok: true, data: trade, fetchedAt: trade.createdAt }, { headers });
  } catch (e) {
    console.error(JSON.stringify({ event: "trades_error", message: e instanceof Error ? e.message : String(e) }));
    return fail("upstream", 502);
  }
}
