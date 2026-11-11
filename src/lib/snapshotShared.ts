// A stock's one-line summary for the watchlist dashboard: types and pure helpers, safe to
// import from the browser. Each part (quality, filings, insiders) loads and fails on its own.
import { formGroup, type Filing } from "./filingsShared";
import type { QualityLevel } from "./quality";
import type { DataIssue } from "./types";

export type Part<T> = { ok: true; data: T } | { ok: false; error: DataIssue };

export type FilingRef = Pick<Filing, "accn" | "form" | "filed" | "reportDate" | "primaryDocument" | "items">;

export interface SnapshotPayload {
  symbol: string;
  cik: number;
  quality: Part<{ passed: number; failed: number; na: number; level: QualityLevel; fiscal: string | null }>;
  filings: Part<{ report: FilingRef | null; latest: FilingRef | null }>;
  /** Open-market purchases and discretionary sales over the last 12 months (Form 4). */
  insiders: Part<{ from: string; to: string; bought: number; sold: number; buyers: number; sellers: number; pending: number; checkedAt: string }>;
}

const REPORT = /^(10-K|10-Q|20-F|40-F)$/;
const MATERIAL = new Set(["annual", "quarterly", "current", "proxy", "registration"]);

const ref = (f: Filing): FilingRef => ({ accn: f.accn, form: f.form, filed: f.filed, reportDate: f.reportDate, primaryDocument: f.primaryDocument, items: f.items });

/**
 * The newest periodic report (10-K, 10-Q, 20-F, 40-F; amendments skipped) and the newest
 * filing that says something about the business (reports, 8-K, proxies, offerings), leaving out
 * insider forms and ownership notices, which have their own column.
 */
export function pickFilings(filings: Filing[]): { report: FilingRef | null; latest: FilingRef | null } {
  const sorted = [...filings].sort((a, b) => (a.filed < b.filed ? 1 : a.filed > b.filed ? -1 : 0));
  const report = sorted.find((f) => REPORT.test(f.form));
  const latest = sorted.find((f) => MATERIAL.has(formGroup(f.form)));
  return { report: report ? ref(report) : null, latest: latest ? ref(latest) : null };
}

/** True once every part has an answer that won't change on the next request. */
export function settled(s: SnapshotPayload): boolean {
  return s.quality.ok && s.filings.ok && s.insiders.ok && s.insiders.data.pending === 0;
}
