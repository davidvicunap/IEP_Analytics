import { NextResponse } from "next/server";
import { QUOTES_PER_REQUEST, dataSource, getQuotes } from "@/lib/data";
import type { QuotesResponse } from "@/lib/types";

/**
 * Quotes for up to QUOTES_PER_REQUEST symbols. Each quote keeps its own fetch time and the
 * response says where the numbers come from; symbols over the limit come back in `skipped`.
 */
export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("symbols") ?? "";
  const entries = await getQuotes(raw.split(",").filter(Boolean));
  const body: QuotesResponse = {
    source: dataSource(),
    limit: QUOTES_PER_REQUEST,
    quotes: entries.flatMap((e) => (e.quote ? [{ ...e.quote, fetchedAt: e.fetchedAt }] : [])),
    // A stored price (quote.basis) comes with the reason FMP failed; it is sent as a quote only.
    missing: entries.flatMap((e) => (e.error && !e.quote ? [{ symbol: e.symbol, error: e.error }] : [])),
    skipped: entries.skipped ?? [],
  };
  // Private while the site is behind the beta gate: no shared CDN caching.
  return NextResponse.json(body, { headers: { "Cache-Control": "private, max-age=15" } });
}
