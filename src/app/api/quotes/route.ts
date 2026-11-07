import { NextResponse } from "next/server";
import { getQuotes } from "@/lib/data";

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("symbols") ?? "";
  const entries = await getQuotes(raw.split(",").filter(Boolean));
  const body = {
    quotes: entries.flatMap((e) => (e.quote ? [e.quote] : [])),
    missing: entries.flatMap((e) => (e.error ? [{ symbol: e.symbol, error: e.error }] : [])),
  };
  // Private while the site is behind the beta gate: no shared CDN caching.
  return NextResponse.json(body, { headers: { "Cache-Control": "private, max-age=15" } });
}
