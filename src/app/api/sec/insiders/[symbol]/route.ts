import { NextResponse } from "next/server";
import { normalizeSymbol } from "@/lib/data";
import { getInsiders } from "@/lib/insiders";

export const maxDuration = 30;

/** Insider transactions from SEC Form 4 filings (public data, outside the beta gate). */
export async function GET(_req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const symbol = normalizeSymbol((await params).symbol);
  if (!symbol) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  const result = await getInsiders(symbol);
  const status = result.ok ? 200 : result.error === "not_found" ? 404 : result.error === "not_configured" ? 503 : 502;
  // While filings are still being read, every request should continue the work.
  const cacheable = result.ok && result.data.pending === 0;
  return NextResponse.json(result, {
    status,
    headers: { "Cache-Control": cacheable ? "public, s-maxage=1800, stale-while-revalidate=3600" : "no-store" },
  });
}
