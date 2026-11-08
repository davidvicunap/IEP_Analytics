import { NextResponse } from "next/server";
import { normalizeSymbol } from "@/lib/data";
import { getFilings } from "@/lib/filings";

export const maxDuration = 30;

/** Every SEC filing of a company (public data, outside the beta gate). ?older=1 adds pre-"recent" pages. */
export async function GET(req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const symbol = normalizeSymbol((await params).symbol);
  if (!symbol) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  const older = new URL(req.url).searchParams.get("older") === "1";
  const result = await getFilings(symbol, older);
  const status = result.ok ? 200 : result.error === "not_found" ? 404 : result.error === "not_configured" ? 503 : 502;
  return NextResponse.json(result, {
    status,
    headers: result.ok ? { "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=3600" } : { "Cache-Control": "no-store" },
  });
}
