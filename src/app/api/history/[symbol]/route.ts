import { NextResponse } from "next/server";
import { getDailyHistory, normalizeSymbol } from "@/lib/data";

/**
 * Daily candles (up to 5 years, oldest first) for one stock. Asked for only where they're used
 * (the plan builder's suggested levels), so an ordinary stock page view spends no FMP call on them.
 * Licensed FMP prices: behind the beta gate and never in shared caches.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const symbol = normalizeSymbol((await params).symbol);
  if (!symbol) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  const result = await getDailyHistory(symbol);
  const status = result.ok ? 200 : result.error === "not_found" ? 404 : result.error === "not_configured" ? 503 : 502;
  return NextResponse.json(result, { status, headers: { "Cache-Control": "private, max-age=300" } });
}
