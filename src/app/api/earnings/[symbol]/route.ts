import { NextResponse } from "next/server";
import { normalizeSymbol } from "@/lib/data";
import { getNextEarnings } from "@/lib/earningsData";

export const maxDuration = 30;

/** Next earnings date (licensed FMP data, with an SEC estimate as fallback): behind the beta gate. */
export async function GET(_req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const symbol = normalizeSymbol((await params).symbol);
  if (!symbol) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  const result = await getNextEarnings(symbol);
  const status = result.ok ? 200 : result.error === "not_found" ? 404 : result.error === "not_configured" ? 503 : 502;
  return NextResponse.json(result, { status, headers: { "Cache-Control": "private, no-store" } });
}
