import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { normalizeSymbol } from "@/lib/data";
import { notebookOwner, sameOrigin } from "@/lib/researchServer";
import { tradeStore } from "@/lib/tradeStore";
import { TRADE_LIMITS, book, parseTradeInput, type Trade } from "@/lib/trades";

const headers = { "Cache-Control": "private, no-store" };
const fail = (error: string, status: number, extra: Record<string, unknown> = {}) => NextResponse.json({ ok: false, error, ...extra }, { status, headers });
const nyToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const MAX_IMPORT = 500;

export interface ImportResult {
  imported: number;
}

/**
 * Logs many trades at once (a broker export read in the browser): `{ trades: [...] }`. All or
 * nothing: one invalid row (400) or a sell of shares not held at that date (409 `oversold`, with
 * the first one) and nothing is saved.
 */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return fail("forbidden", 403);
  const owner = await notebookOwner(await cookies());
  if (!owner) return fail("beta_required", 401);
  const store = tradeStore();
  if (!store) return fail("not_configured", 503);
  const body = (await request.json().catch(() => null)) as { trades?: unknown } | null;
  const raw = Array.isArray(body?.trades) ? body.trades : null;
  if (!raw || raw.length === 0 || raw.length > MAX_IMPORT) return fail("invalid", 400);
  const today = nyToday();
  const now = Date.now();
  const incoming: Trade[] = [];
  for (const [i, r] of raw.entries()) {
    const symbol = r && typeof r === "object" && typeof (r as { symbol?: unknown }).symbol === "string" ? normalizeSymbol((r as { symbol: string }).symbol) : null;
    const input = parseTradeInput(r, today);
    if (!symbol || !input) return fail("invalid", 400, { row: i });
    // Spread creation times so the order within a day follows the file.
    incoming.push({ id: crypto.randomUUID().slice(0, 12), symbol, createdAt: new Date(now + i).toISOString(), ...input });
  }
  try {
    const all = await store.list(owner);
    if (all.length + incoming.length > TRADE_LIMITS.perOwner) return fail("invalid", 400);
    const before = book(all).oversold.length;
    const after = book([...all, ...incoming]).oversold;
    if (after.length > before) return fail("oversold", 409, { first: after[0] });
    for (const t of incoming) await store.add(owner, t);
    return NextResponse.json({ ok: true, data: { imported: incoming.length } satisfies ImportResult, fetchedAt: new Date().toISOString() }, { headers });
  } catch (e) {
    console.error(JSON.stringify({ event: "trades_import_error", message: e instanceof Error ? e.message : String(e) }));
    return fail("upstream", 502);
  }
}
