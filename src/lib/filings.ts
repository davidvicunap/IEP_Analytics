// SEC filings for a company, from the EDGAR submissions API (public data), with direct links
// to each document, its index page and the interactive XBRL viewer.
import { unstable_cache } from "next/cache";
import { getDb } from "@/db/client";
import { secJson, submissionsUrl } from "./sec";
import { getSecurity } from "./securities";
import type { DataIssue, Result } from "./types";

import { formGroup, type Filing, type FilingsPayload } from "./filingsShared";
export * from "./filingsShared";

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
