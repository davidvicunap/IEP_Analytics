import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { isAuthorizedCron } from "@/lib/cron";
import { fetchCompanyTickers } from "@/lib/sec";
import { refreshSecurities } from "@/lib/securities";

export const maxDuration = 60;

/** Daily refresh of the securities list from the SEC (scheduled in vercel.json). */
export async function GET(request: Request) {
  if (!isAuthorizedCron(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const db = getDb();
  if (!db) return NextResponse.json({ error: "database_not_configured" }, { status: 503 });
  try {
    const result = await refreshSecurities(db, await fetchCompanyTickers());
    console.info(JSON.stringify({ event: "cron_securities_ok", ...result }));
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(JSON.stringify({ event: "cron_securities_failed", message }));
    return NextResponse.json({ error: "refresh_failed" }, { status: 502 });
  }
}
