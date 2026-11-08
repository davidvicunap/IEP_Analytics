// Background jobs for sector data, shared by the build script and the daily cron.
import type { Db } from "@/db/client";
import { backfillSic, latestMetricsYear, refreshCompanyMetrics } from "./peers";

const METRICS_STALE_MS = 7 * 24 * 60 * 60 * 1000;

/** Refreshes yearly peer inputs when older than a week, then fills SIC codes with the time left. */
export async function runSectorJobs(db: Db, budgetMs: number) {
  const started = Date.now();
  const out: Record<string, unknown> = {};
  const latest = await latestMetricsYear(db);
  if (!latest || Date.now() - latest.updatedAt.getTime() > METRICS_STALE_MS) {
    try {
      out.metrics = await refreshCompanyMetrics(db);
    } catch (e) {
      out.metricsError = e instanceof Error ? e.message : String(e);
    }
  } else {
    out.metrics = { fresh: true, year: latest.year };
  }
  const left = budgetMs - (Date.now() - started);
  out.sic = left > 5_000 ? await backfillSic(db, left) : { skipped: "no_time_left" };
  return out;
}
