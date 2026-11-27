// A stock's one-line SEC summary for the hub's companies list: types and pure helpers, safe to
// import from the browser. Only what a row shows: its latest report, this week's filings about
// the business and when results are next expected. (Quality and insider trades have their own
// pages; reading Form 4 filings here made every row wait on the SEC and never cache.)
import { estimateFromReleases } from "./earnings";
import { formGroup, type Filing } from "./filingsShared";
import type { DataIssue } from "./types";

export type Part<T> = { ok: true; data: T } | { ok: false; error: DataIssue };

export type FilingRef = Pick<Filing, "accn" | "form" | "filed" | "reportDate" | "primaryDocument" | "items">;

export interface SnapshotPayload {
  symbol: string;
  cik: number;
  filings: Part<{
    /** The newest periodic report (a holding's "report filed" reason). */
    report: FilingRef | null;
    /** Filings about the business in the last 7 days, newest first. */
    recent: FilingRef[];
    /** When results are next expected: 52 weeks after last year's release for that quarter (SEC, no quota). */
    nextResults: { date: string; basedOn: string } | null;
  }>;
}

const REPORT = /^(10-K|10-Q|20-F|40-F)$/;
const RECENT_DAYS = 7;
const MAX_RECENT = 5;
const MATERIAL = new Set(["annual", "quarterly", "current", "proxy", "registration"]);

const ref = (f: Filing): FilingRef => ({ accn: f.accn, form: f.form, filed: f.filed, reportDate: f.reportDate, primaryDocument: f.primaryDocument, items: f.items });

/**
 * The newest periodic report (10-K, 10-Q, 20-F, 40-F; amendments skipped) and the last week's
 * filings that say something about the business (reports, 8-K, proxies, offerings), leaving out
 * insider forms and ownership notices.
 */
export function pickFilings(filings: Filing[], today = new Date().toISOString().slice(0, 10)): Extract<SnapshotPayload["filings"], { ok: true }>["data"] {
  const sorted = [...filings].sort((a, b) => (a.filed < b.filed ? 1 : a.filed > b.filed ? -1 : 0));
  const report = sorted.find((f) => REPORT.test(f.form));
  const weekAgo = new Date(Date.parse(today) - RECENT_DAYS * 86_400_000).toISOString().slice(0, 10);
  const recent = sorted.filter((f) => MATERIAL.has(formGroup(f.form)) && f.filed >= weekAgo && f.filed <= today).slice(0, MAX_RECENT).map(ref);
  const releases = filings.filter((f) => /^8-K/.test(f.form) && f.items.includes("2.02")).map((f) => f.filed);
  const next = estimateFromReleases(releases, today);
  return {
    report: report ? ref(report) : null,
    recent,
    nextResults: next && next.kind === "estimated" ? { date: next.date, basedOn: next.basedOn } : null,
  };
}

/** A summary worth caching: the filings answered (a failure is asked for again next time). */
export function settled(s: SnapshotPayload): boolean {
  return s.filings.ok;
}
