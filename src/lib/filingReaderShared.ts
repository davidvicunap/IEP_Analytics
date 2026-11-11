// The filing reader's payload: types only, safe to import from the browser.
import type { RiskDiff, Section, SectionKey } from "./filingReader";

export interface ReportRef {
  accn: string;
  form: string;
  filed: string;
  reportDate: string | null;
  primaryDocument: string;
}

export interface ReaderPayload {
  symbol: string;
  cik: number;
  name: string;
  filing: ReportRef;
  reports: ReportRef[]; // the company's 10-Ks, newest first (to switch year)
  section: SectionKey;
  content: Section | null; // null: this filing doesn't have the section where we look for it
  /** Risk factors only: this year's titles against the previous 10-K's. */
  risks: { prior: ReportRef; diff: RiskDiff } | null;
  risksNote: "noPrior" | "noTitles" | "priorUnavailable" | null;
}
