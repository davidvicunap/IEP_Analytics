// A stock's one-line SEC summary for the hub's companies list: types and pure helpers, safe to
// import from the browser. Each part (quality, filings, insiders) loads and fails on its own.
import { estimateFromReleases } from "./earnings";
import { formGroup, type Filing } from "./filingsShared";
import type { QualityLevel } from "./quality";
import type { DataIssue } from "./types";

export type Part<T> = { ok: true; data: T } | { ok: false; error: DataIssue };

export type FilingRef = Pick<Filing, "accn" | "form" | "filed" | "reportDate" | "primaryDocument" | "items">;

export interface SnapshotPayload {
  symbol: string;
  cik: number;
  quality: Part<{ passed: number; failed: number; na: number; level: QualityLevel; fiscal: string | null }>;
  filings: Part<{
    report: FilingRef | null;
    /** The newest annual report (its period end gives the fiscal year end: the calendar's deadlines). */
    annual?: FilingRef | null;
    latest: FilingRef | null;
    /** Filings about the business in the last 7 days, newest first (the home briefing). */
    recent: FilingRef[];
    /** When results are next expected: 52 weeks after last year's release for that quarter (SEC, no quota). */
    nextResults: { date: string; basedOn: string } | null;
  }>;
  /** Open-market purchases and discretionary sales over the last 12 months (Form 4). */
  insiders: Part<{ from: string; to: string; bought: number; sold: number; buyers: number; sellers: number; pending: number; checkedAt: string }>;
}

const REPORT = /^(10-K|10-Q|20-F|40-F)$/;
const RECENT_DAYS = 7;
const MAX_RECENT = 5;
const MATERIAL = new Set(["annual", "quarterly", "current", "proxy", "registration"]);

const ref = (f: Filing): FilingRef => ({ accn: f.accn, form: f.form, filed: f.filed, reportDate: f.reportDate, primaryDocument: f.primaryDocument, items: f.items });

/**
 * The newest periodic report (10-K, 10-Q, 20-F, 40-F; amendments skipped) and the newest
 * filing that says something about the business (reports, 8-K, proxies, offerings), leaving out
 * insider forms and ownership notices, which have their own column.
 */
export function pickFilings(filings: Filing[], today = new Date().toISOString().slice(0, 10)): Extract<SnapshotPayload["filings"], { ok: true }>["data"] {
  const sorted = [...filings].sort((a, b) => (a.filed < b.filed ? 1 : a.filed > b.filed ? -1 : 0));
  const report = sorted.find((f) => REPORT.test(f.form));
  const annual = sorted.find((f) => /^(10-K|20-F|40-F)$/.test(f.form));
  const latest = sorted.find((f) => MATERIAL.has(formGroup(f.form)));
  const weekAgo = new Date(Date.parse(today) - RECENT_DAYS * 86_400_000).toISOString().slice(0, 10);
  const recent = sorted.filter((f) => MATERIAL.has(formGroup(f.form)) && f.filed >= weekAgo && f.filed <= today).slice(0, MAX_RECENT).map(ref);
  const releases = filings.filter((f) => /^8-K/.test(f.form) && f.items.includes("2.02")).map((f) => f.filed);
  const next = estimateFromReleases(releases, today);
  return {
    report: report ? ref(report) : null,
    annual: annual ? ref(annual) : null,
    latest: latest ? ref(latest) : null,
    recent,
    nextResults: next && next.kind === "estimated" ? { date: next.date, basedOn: next.basedOn } : null,
  };
}

/** True once every part has an answer that won't change on the next request. */
export function settled(s: SnapshotPayload): boolean {
  return s.quality.ok && s.filings.ok && s.insiders.ok && s.insiders.data.pending === 0;
}
