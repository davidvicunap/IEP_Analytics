import { NextResponse } from "next/server";
import { getDailyHistory, isDemo } from "@/lib/data";
import type { DataSource } from "@/lib/types";

export interface BenchmarkPayload {
  symbol: "SPY";
  source: DataSource;
  /** Daily closes, oldest first (up to 5 years). */
  closes: { time: string; close: number }[];
}

/**
 * The S&P 500 (through the SPY fund) as daily closes, for comparing closed trades with the
 * market over the same dates. Licensed prices: behind the beta gate, never in shared caches.
 */
export async function GET() {
  const r = await getDailyHistory("SPY");
  const headers = { "Cache-Control": "private, no-store" };
  if (!r.ok) return NextResponse.json(r, { status: r.error === "not_configured" ? 503 : 502, headers });
  const data: BenchmarkPayload = { symbol: "SPY", source: isDemo() ? "DEMO" : "FMP", closes: r.data.map((c) => ({ time: c.time, close: c.close })) };
  return NextResponse.json({ ok: true, data, fetchedAt: r.fetchedAt }, { headers });
}
