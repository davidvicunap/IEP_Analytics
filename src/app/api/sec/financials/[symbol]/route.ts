import { NextResponse } from "next/server";
import { normalizeSymbol } from "@/lib/data";
import { getFinancials } from "@/lib/financials";

export const maxDuration = 30;

/** SEC financial statements. Public-domain data, so it is served outside the beta gate. */
export async function GET(_req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const symbol = normalizeSymbol((await params).symbol);
  if (!symbol) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  const result = await getFinancials(symbol);
  const status = result.ok ? 200 : result.error === "not_found" ? 404 : result.error === "not_configured" ? 503 : 502;
  return NextResponse.json(result, {
    status,
    headers: result.ok ? { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } : { "Cache-Control": "no-store" },
  });
}
