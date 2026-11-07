import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { getRedis } from "@/lib/redis";
import { providerCallsToday, providerDailyLimit } from "@/lib/quota";
import { securitiesStatus } from "@/lib/securities";

export const dynamic = "force-dynamic";

/**
 * Public health check for uptime monitors. Reports only service status and counts,
 * never market data, so it can stay outside the beta gate.
 */
export async function GET() {
  const db = getDb();
  let database: Record<string, unknown> = { status: "not_configured" };
  if (db) {
    try {
      const s = await securitiesStatus(db);
      database = { status: "ok", securities: s.active, securitiesUpdatedAt: s.updatedAt };
    } catch {
      database = { status: "error" };
    }
  }

  const redis = getRedis();
  let cache: Record<string, unknown> = { status: "not_configured" };
  if (redis) {
    try {
      await redis.ping();
      cache = { status: "ok", fmpCallsToday: await providerCallsToday("fmp"), fmpDailyLimit: providerDailyLimit() };
    } catch {
      cache = { status: "error" };
    }
  }

  const ok = database.status !== "error" && cache.status !== "error";
  return NextResponse.json(
    { ok, database, cache, fmpConfigured: Boolean(process.env.FMP_API_KEY), time: new Date().toISOString() },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
