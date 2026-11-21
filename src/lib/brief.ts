// The home page's morning briefing: what changed for the stocks you follow, in four short
// lists. Pure: the inputs (SEC summaries, your fair values, prices) are loaded by the page.
import { upside } from "./research";
import type { FilingRef, SnapshotPayload } from "./snapshotShared";

export const BRIEF_LIMIT = 6;
export const RESULTS_DAYS = 14;

export interface BriefInput {
  symbol: string;
  snapshot: SnapshotPayload | null;
  price: number | null;
  fairValue: number | null;
}

export interface Brief {
  /** Last 7 days, one row per stock and form (five proxy supplements are one row), newest first. */
  filings: { symbol: string; cik: number; filing: FilingRef; count: number }[];
  results: { symbol: string; date: string; basedOn: string }[]; // next 2 weeks, soonest first
  fairValue: { symbol: string; price: number; fairValue: number; gap: number }[]; // gap = fair value ÷ price − 1, widest first
  insiders: { symbol: string; bought: number; sold: number; buyers: number; partial: boolean }[]; // open-market buying, largest first
}

const DAY = 86_400_000;

export function buildBrief(rows: BriefInput[], today: string): Brief {
  const until = new Date(Date.parse(today) + RESULTS_DAYS * DAY).toISOString().slice(0, 10);
  const filings: Brief["filings"] = [];
  const results: Brief["results"] = [];
  const fairValue: Brief["fairValue"] = [];
  const insiders: Brief["insiders"] = [];

  for (const r of rows) {
    const s = r.snapshot;
    if (s?.filings.ok) {
      for (const f of s.filings.data.recent) {
        const same = filings.find((x) => x.symbol === r.symbol && x.filing.form === f.form);
        if (!same) filings.push({ symbol: r.symbol, cik: s.cik, filing: f, count: 1 });
        else {
          same.count++;
          if (f.filed > same.filing.filed) same.filing = f;
        }
      }
      const n = s.filings.data.nextResults;
      if (n && n.date >= today && n.date <= until) results.push({ symbol: r.symbol, ...n });
    }
    const gap = upside(r.fairValue, r.price);
    if (gap !== null && r.price !== null && r.fairValue !== null) fairValue.push({ symbol: r.symbol, price: r.price, fairValue: r.fairValue, gap });
    if (s?.insiders.ok && s.insiders.data.bought > 0) {
      const d = s.insiders.data;
      insiders.push({ symbol: r.symbol, bought: d.bought, sold: d.sold, buyers: d.buyers, partial: d.pending > 0 });
    }
  }

  const bySymbol = (a: { symbol: string }, b: { symbol: string }) => a.symbol.localeCompare(b.symbol);
  return {
    filings: filings.sort((a, b) => b.filing.filed.localeCompare(a.filing.filed) || bySymbol(a, b)).slice(0, BRIEF_LIMIT),
    results: results.sort((a, b) => a.date.localeCompare(b.date) || bySymbol(a, b)).slice(0, BRIEF_LIMIT),
    fairValue: fairValue.sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap) || bySymbol(a, b)).slice(0, BRIEF_LIMIT),
    insiders: insiders.sort((a, b) => b.bought - a.bought || bySymbol(a, b)).slice(0, BRIEF_LIMIT),
  };
}

/** "Good morning" until noon, afternoon until 7 pm, then evening, in the reader's own clock. */
export function partOfDay(hour: number): "morning" | "afternoon" | "evening" {
  return hour < 12 ? "morning" : hour < 19 ? "afternoon" : "evening";
}
