import { NextResponse } from "next/server";
import { normalizeSymbol } from "@/lib/data";
import { getSnapshot } from "@/lib/snapshot";
import { settled } from "@/lib/snapshotShared";

export const maxDuration = 30;

/** One watchlist row: quality, latest filings and insider trades (public SEC data). */
export async function GET(_req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const symbol = normalizeSymbol((await params).symbol);
  if (!symbol) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  const result = await getSnapshot(symbol);
  const status = result.ok ? 200 : result.error === "not_found" ? 404 : result.error === "not_configured" ? 503 : 502;
  // A row with a failed part or insider filings still to read is asked for again next time.
  const cacheable = result.ok && settled(result.data);
  return NextResponse.json(result, {
    status,
    headers: { "Cache-Control": cacheable ? "public, s-maxage=1800, stale-while-revalidate=3600" : "no-store" },
  });
}
