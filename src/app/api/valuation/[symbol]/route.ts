import { NextResponse } from "next/server";
import { normalizeSymbol } from "@/lib/data";
import { getValuation } from "@/lib/valuationData";

export const maxDuration = 30;

/**
 * Valuation (multiples, history, peers, DCF inputs). Uses licensed FMP prices, so unlike
 * /api/sec/* it stays behind the beta gate and is never cached by shared caches.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const symbol = normalizeSymbol((await params).symbol);
  if (!symbol) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  const result = await getValuation(symbol);
  const status = result.ok ? 200 : result.error === "not_found" ? 404 : result.error === "not_configured" ? 503 : 502;
  return NextResponse.json(result, { status, headers: { "Cache-Control": "private, no-store" } });
}
