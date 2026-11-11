// Server-side: the next earnings date for the stock header. FMP first (one call per stock per
// day, cached); if FMP can't answer (not in the plan, daily limit, demo), an estimate from SEC
// results releases, which costs no quota. Each answer says where it came from.
import { isDemo } from "./data";
import { estimateFromReleases, nextListed, type NextEarnings } from "./earnings";
import { getFilings } from "./filings";
import { fmpEarnings } from "./fmp";
import type { DataIssue, Result } from "./types";

export interface EarningsPayload {
  symbol: string;
  next: NextEarnings;
  /** Why FMP's date isn't shown, when it isn't (the estimate or "unknown" is used instead). */
  fmpIssue: DataIssue | null;
}

export async function getNextEarnings(symbol: string, today = new Date().toISOString().slice(0, 10)): Promise<Result<EarningsPayload>> {
  let fmpIssue: DataIssue | null = null;
  let fetchedAt = new Date().toISOString();
  if (isDemo()) fmpIssue = "not_configured";
  else {
    const r = await fmpEarnings(symbol);
    if (r.ok) {
      const listed = nextListed(r.data, today);
      if (listed) return { ok: true, data: { symbol, next: listed, fmpIssue: null }, fetchedAt: r.fetchedAt };
      fetchedAt = r.fetchedAt;
      fmpIssue = "not_found";
    } else fmpIssue = r.error;
  }
  const filings = await getFilings(symbol);
  if (filings.ok) {
    const releases = filings.data.filings.filter((f) => /^8-K/.test(f.form) && f.items.includes("2.02")).map((f) => f.filed);
    const estimate = estimateFromReleases(releases, today);
    if (estimate) return { ok: true, data: { symbol, next: estimate, fmpIssue }, fetchedAt };
  } else if (fmpIssue !== "not_found") {
    // Neither source answered: report FMP's reason (the SEC one is usually "not configured" in demo).
    return { ok: false, error: fmpIssue ?? filings.error };
  }
  return { ok: true, data: { symbol, next: { kind: "unknown" }, fmpIssue }, fetchedAt };
}
