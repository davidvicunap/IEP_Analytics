import { NextResponse } from "next/server";
import { normalizeSymbol } from "@/lib/data";
import { getFinancials } from "@/lib/financials";
import { quarterReview, type QuarterReview } from "@/lib/quarterReview";

export const maxDuration = 30;

export interface QuarterPayload {
  symbol: string;
  cik: number;
  review: QuarterReview | null; // null: no quarterly figures in the filings
}

/** The latest quarter against a year earlier and the quarter before (public SEC data). */
export async function GET(_req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const symbol = normalizeSymbol((await params).symbol);
  if (!symbol) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  const fin = await getFinancials(symbol);
  if (!fin.ok) {
    const status = fin.error === "not_found" ? 404 : fin.error === "not_configured" ? 503 : 502;
    return NextResponse.json(fin, { status, headers: { "Cache-Control": "no-store" } });
  }
  const data: QuarterPayload = { symbol, cik: fin.data.cik, review: quarterReview(fin.data.quarterly, fin.data.shares.splits) };
  return NextResponse.json(
    { ok: true, data, fetchedAt: fin.fetchedAt },
    { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } },
  );
}
