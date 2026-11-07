import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { isAuthorizedCron } from "@/lib/cron";
import { runSectorJobs } from "@/lib/secJobs";

export const maxDuration = 60;

/** Daily: weekly refresh of peer inputs (SEC frames) and gradual SIC backfill (scheduled in vercel.json). */
export async function GET(request: Request) {
  if (!isAuthorizedCron(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const db = getDb();
  if (!db) return NextResponse.json({ error: "database_not_configured" }, { status: 503 });
  try {
    const result = await runSectorJobs(db, 50_000);
    console.info(JSON.stringify({ event: "cron_sec_metrics", ...result }));
    return NextResponse.json({ ok: !("metricsError" in result), ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(JSON.stringify({ event: "cron_sec_metrics_failed", message }));
    return NextResponse.json({ error: "failed" }, { status: 502 });
  }
}
