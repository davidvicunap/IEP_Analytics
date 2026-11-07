// SEC filings for a company, from the EDGAR submissions API (public data), with direct links
// to each document, its index page and the interactive XBRL viewer.
import { unstable_cache } from "next/cache";
import { getDb } from "@/db/client";
import { secJson, submissionsUrl } from "./sec";
import { getSecurity } from "./securities";
import type { DataIssue, Result } from "./types";

export interface Filing {
  accn: string;
  form: string;
  filed: string; // YYYY-MM-DD
  reportDate: string | null; // period the filing covers, when it has one
  primaryDocument: string;
  description: string;
  items: string[]; // 8-K items, e.g. ["2.02", "9.01"]
  inlineXbrl: boolean;
}

export type FormGroup = "annual" | "quarterly" | "current" | "proxy" | "insiders" | "ownership" | "registration" | "other";

const GROUPS: [FormGroup, RegExp][] = [
  ["annual", /^(10-K|10-KT|20-F|40-F)(\/A)?$/],
  ["quarterly", /^10-Q(\/A)?$/],
  ["current", /^(8-K|6-K)(\/A)?$/],
  ["proxy", /^(DEF 14A|DEFA14A|DEFM14A|PRE 14A|PX14A6G|DEF 14C|PRE 14C)$/],
  ["insiders", /^(3|4|5|144)(\/A)?$/],
  ["ownership", /^(SC 13[DG]|SCHEDULE 13[DG])(\/A)?$/],
  ["registration", /^(S-1|S-3|S-3ASR|S-4|S-8|S-8 POS|F-1|F-3|424B\d|FWP)(\/A)?$/],
];

export function formGroup(form: string): FormGroup {
  for (const [g, re] of GROUPS) if (re.test(form)) return g;
  return "other";
}

type Recent = {
  accessionNumber?: string[];
  form?: string[];
  filingDate?: string[];
  reportDate?: string[];
  primaryDocument?: string[];
  primaryDocDescription?: string[];
  items?: string[];
  isInlineXBRL?: number[];
};

/** Filings from a submissions "recent" block (or an older page, which has the same shape). */
export function parseFilings(recent: Recent): Filing[] {
  const n = recent.accessionNumber?.length ?? 0;
  const out: Filing[] = [];
  for (let i = 0; i < n; i++) {
    const accn = recent.accessionNumber?.[i];
    const form = recent.form?.[i];
    const filed = recent.filingDate?.[i];
    if (!accn || !form || !filed) continue;
    out.push({
      accn,
      form,
      filed,
      reportDate: recent.reportDate?.[i] || null,
      primaryDocument: recent.primaryDocument?.[i] ?? "",
      description: (recent.primaryDocDescription?.[i] ?? "").trim(),
      items: (recent.items?.[i] ?? "").split(",").map((s) => s.trim()).filter(Boolean),
      inlineXbrl: recent.isInlineXBRL?.[i] === 1,
    });
  }
  return out.sort((a, b) => (a.filed < b.filed ? 1 : a.filed > b.filed ? -1 : 0));
}

const folder = (cik: number, accn: string) => `https://www.sec.gov/Archives/edgar/data/${cik}/${accn.replace(/-/g, "")}`;
export const filingIndexUrl = (cik: number, accn: string) => `${folder(cik, accn)}/${accn}-index.htm`;
/** The main document. XSL-rendered paths (Form 4) are kept: they are the readable version. */
export const filingDocUrl = (cik: number, f: Pick<Filing, "accn" | "primaryDocument">) =>
  f.primaryDocument ? `${folder(cik, f.accn)}/${f.primaryDocument}` : filingIndexUrl(cik, f.accn);
/** SEC's interactive viewer: every tagged number in the document can be inspected. */
export const xbrlViewerUrl = (cik: number, f: Pick<Filing, "accn" | "primaryDocument">) =>
  `https://www.sec.gov/ix?doc=/Archives/edgar/data/${cik}/${f.accn.replace(/-/g, "")}/${f.primaryDocument}`;

export interface FilingsPayload {
  symbol: string;
  cik: number;
  name: string;
  filings: Filing[];
  older: { available: boolean; loaded: boolean; from: string | null };
}

interface SubmissionsDoc {
  name?: string;
  filings?: { recent?: Recent; files?: { name: string; filingFrom?: string }[] };
}

async function fetchFilings(cik: number, older: boolean): Promise<Omit<FilingsPayload, "symbol">> {
  const sub = (await secJson(submissionsUrl(cik))) as SubmissionsDoc;
  const filings = parseFilings(sub.filings?.recent ?? {});
  const files = sub.filings?.files ?? [];
  if (older) {
    for (const f of files) filings.push(...parseFilings((await secJson(`https://data.sec.gov/submissions/${f.name}`)) as Recent));
    filings.sort((a, b) => (a.filed < b.filed ? 1 : -1));
  }
  return {
    cik,
    name: sub.name ?? "",
    filings,
    older: { available: files.length > 0, loaded: older && files.length > 0, from: files.at(-1)?.filingFrom ?? null },
  };
}

const cachedFilings = unstable_cache(fetchFilings, ["sec-filings-v1"], { revalidate: 3600, tags: ["sec"] });

export async function getFilings(symbol: string, older = false): Promise<Result<FilingsPayload>> {
  const db = getDb();
  if (!db) return { ok: false, error: "not_configured" };
  try {
    const security = await getSecurity(db, symbol);
    if (!security) return { ok: false, error: "not_found" };
    const data = await cachedFilings(security.cik, older);
    return { ok: true, data: { ...data, symbol: security.symbol }, fetchedAt: new Date().toISOString() };
  } catch (e) {
    const status = (e as { status?: number }).status;
    const kind: DataIssue = status === 429 ? "rate_limited" : status === 404 ? "not_found" : "upstream";
    console.error(JSON.stringify({ event: "filings_error", symbol, status: status ?? null, message: e instanceof Error ? e.message : String(e) }));
    return { ok: false, error: kind };
  }
}
