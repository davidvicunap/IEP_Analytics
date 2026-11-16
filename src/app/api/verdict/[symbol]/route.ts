import { NextResponse } from "next/server";
import { normalizeSymbol } from "@/lib/data";
import { getVerdict } from "@/lib/verdictData";

export const maxDuration = 30;

/** "At a glance" for a stock: SEC figures plus the cached quote and price history (behind the beta gate). */
export async function GET(_req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const symbol = normalizeSymbol((await params).symbol);
  if (!symbol) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  const result = await getVerdict(symbol);
  const status = result.ok ? 200 : result.error === "not_found" ? 404 : result.error === "not_configured" ? 503 : 502;
  return NextResponse.json(result, { status, headers: { "Cache-Control": "private, no-store" } });
}
