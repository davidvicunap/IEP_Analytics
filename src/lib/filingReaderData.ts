// Server-side: a 10-K section for the filing reader, from the document on EDGAR (public domain).
// Filed documents never change, so each section is cached for a month; a parsed document is
// also kept in memory briefly, since a reader usually opens the three sections in a row.
import { unstable_cache } from "next/cache";
import { getDb } from "@/db/client";
import { compareRisks, findSections, htmlToBlocks, markRisks, riskTitles, truncateSection, type Section, type SectionKey } from "./filingReader";
import type { ReaderPayload, ReportRef } from "./filingReaderShared";
import { filingDocUrl, getFilings } from "./filings";
import { secText } from "./sec";
import type { DataIssue, Result } from "./types";

const ANNUAL = /^10-K$/; // amendments (10-K/A) usually hold only Part III, so they're left out
const MAX_REPORTS = 8;

class ReaderError extends Error {
  constructor(readonly kind: DataIssue) {
    super(`reader:${kind}`);
  }
}

type Parsed = Record<SectionKey, Section | null>;
const memory = new Map<string, Promise<Parsed>>();

/** The document's sections, parsed once per server instance for the last few documents. */
function parsed(cik: number, ref: ReportRef): Promise<Parsed> {
  const key = `${cik}/${ref.accn}`;
  let p = memory.get(key);
  if (!p) {
    p = secText(filingDocUrl(cik, ref), 40_000).then((html) => findSections(htmlToBlocks(html)));
    p.catch(() => memory.delete(key));
    memory.set(key, p);
    while (memory.size > 4) memory.delete(memory.keys().next().value as string);
  }
  return p;
}

async function buildSection(cik: number, ref: ReportRef, section: SectionKey, prior: ReportRef | null) {
  let doc: Parsed;
  try {
    doc = await parsed(cik, ref);
  } catch (e) {
    const status = (e as { status?: number }).status;
    throw new ReaderError(status === 429 ? "rate_limited" : status === 404 ? "not_found" : "upstream");
  }
  let content = doc[section];
  let risks: ReaderPayload["risks"] = null;
  let risksNote: ReaderPayload["risksNote"] = null;
  if (section === "risks" && content) {
    const now = riskTitles(content);
    if (!prior) risksNote = "noPrior";
    else if (now.length < 3) risksNote = "noTitles";
    else {
      try {
        const before = riskTitles((await parsed(cik, prior)).risks);
        if (before.length < 3) risksNote = "noTitles";
        else {
          const diff = compareRisks(now, before);
          risks = { prior, diff };
          content = markRisks(content, diff);
        }
      } catch {
        risksNote = "priorUnavailable";
      }
    }
  }
  return { content: content ? truncateSection(content) : null, risks, risksNote };
}

// Only results that can't change are cached: a failed comparison is retried next time.
const cachedSection = unstable_cache(
  async (cik: number, ref: ReportRef, section: SectionKey, prior: ReportRef | null) => {
    const r = await buildSection(cik, ref, section, prior);
    if (r.risksNote === "priorUnavailable") throw new ReaderError("upstream");
    return r;
  },
  ["sec-reader-v1"],
  { revalidate: 30 * 86_400, tags: ["sec"] },
);

export async function getReport(symbol: string, accn: string | null, section: SectionKey): Promise<Result<ReaderPayload>> {
  if (!getDb()) return { ok: false, error: "not_configured" };
  const filings = await getFilings(symbol);
  if (!filings.ok) return filings;
  const { cik, name } = filings.data;
  const reports: ReportRef[] = filings.data.filings
    .filter((f) => ANNUAL.test(f.form) && f.primaryDocument)
    .slice(0, MAX_REPORTS)
    .map((f) => ({ accn: f.accn, form: f.form, filed: f.filed, reportDate: f.reportDate, primaryDocument: f.primaryDocument }));
  const i = accn ? reports.findIndex((r) => r.accn === accn) : 0;
  const ref = reports[i];
  if (!ref) return { ok: false, error: "not_found" };
  const prior = reports[i + 1] ?? null;

  try {
    let r;
    try {
      r = await cachedSection(cik, ref, section, prior);
    } catch (e) {
      // The comparison failed (the earlier filing couldn't be read): still show this year's text.
      if (!(e instanceof ReaderError) || section !== "risks") throw e;
      r = await buildSection(cik, ref, section, prior);
    }
    return {
      ok: true,
      data: { symbol: filings.data.symbol, cik, name, filing: ref, reports, section, content: r.content, risks: r.risks, risksNote: r.risksNote },
      fetchedAt: new Date().toISOString(),
    };
  } catch (e) {
    if (e instanceof ReaderError) return { ok: false, error: e.kind };
    console.error(JSON.stringify({ event: "reader_error", symbol, accn: ref.accn, section, message: e instanceof Error ? e.message : String(e) }));
    return { ok: false, error: "upstream" };
  }
}
