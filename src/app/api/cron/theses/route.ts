import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cron";
import { researchStore } from "@/lib/researchServer";
import { alertStore } from "@/lib/thesisAlertStore";
import { checkTheses, factsCache, marketDate } from "@/lib/thesesData";
import { notifyFired, recordingFires } from "@/lib/thesisNotify";

export const maxDuration = 60;

/**
 * Weekdays, a few times while the US market is open and once after the close: checks everyone's
 * live theses, so alerts are recorded (and sent to phones) even when nobody opens the app
 * (scheduled in vercel.json). Stocks shared by several people load once per run.
 */
export async function GET(request: Request) {
  if (!isAuthorizedCron(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const notes = researchStore();
  const store = alertStore();
  if (!notes || !store) return NextResponse.json({ error: "database_not_configured" }, { status: 503 });
  const now = new Date();
  const facts = factsCache(marketDate(now));
  const { alerts, fired } = recordingFires(store);
  const summary = { owners: 0, checked: 0, alerts: 0, skipped: 0, failed: 0 };
  for (const owner of await notes.owners()) {
    try {
      const r = await checkTheses(owner, await notes.list(owner), alerts, facts, now, Infinity); // every thesis, every night
      summary.owners++;
      summary.checked += r.items.length;
      summary.alerts += r.items.reduce((n, i) => n + i.alerts.length, 0);
      summary.skipped += r.skipped;
    } catch (e) {
      summary.failed++;
      console.error(JSON.stringify({ event: "cron_theses_owner_failed", message: e instanceof Error ? e.message : String(e) }));
    }
  }
  const pushed = await notifyFired(fired, { now });
  console.info(JSON.stringify({ event: "cron_theses", ...summary, pushed }));
  return NextResponse.json({ ok: summary.failed === 0, ...summary, pushed });
}
