// Server-side: SEC financial statements for a ticker, cached for a day.
import { unstable_cache } from "next/cache";
import { getDb } from "@/db/client";
import { secUserAgent } from "./sec";
import { companyFactsUrl, parseCompanyFacts, type Financials } from "./secFinancials";
import { getSecurity } from "./securities";
import type { DataIssue, Result } from "./types";

export type FinancialsPayload = Financials & { symbol: string; fetchedAt: string };

class SecError extends Error {
  constructor(readonly kind: DataIssue, readonly status?: number) {
    super(`sec:${kind}`);
  }
}

async function fetchFinancials(cik: number): Promise<Financials & { fetchedAt: string }> {
  let res: Response;
  try {
    res = await fetch(companyFactsUrl(cik), {
      headers: { "User-Agent": secUserAgent(), Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new SecError("upstream");
  }
  // 404: the company files no XBRL financial data (e.g. many ETFs and funds).
  if (res.status === 404) throw new SecError("not_found", 404);
  if (res.status === 429) throw new SecError("rate_limited", 429);
  if (!res.ok) throw new SecError("upstream", res.status);
  return { ...parseCompanyFacts(await res.json()), fetchedAt: new Date().toISOString() };
}

// Only successful, parsed results are cached (a few KB, not the multi-MB raw payload).
const cachedFinancials = unstable_cache((cik: number) => fetchFinancials(cik), ["sec-financials-v3"], {
  revalidate: 86_400,
  tags: ["sec"],
});

export async function getFinancials(symbol: string): Promise<Result<FinancialsPayload>> {
  const db = getDb();
  if (!db) return { ok: false, error: "not_configured" };
  try {
    const security = await getSecurity(db, symbol);
    if (!security) return { ok: false, error: "not_found" };
    const data = await cachedFinancials(security.cik);
    if (data.annual.periods.length === 0 && data.quarterly.periods.length === 0) return { ok: false, error: "not_found" };
    return { ok: true, data: { ...data, symbol: security.symbol }, fetchedAt: data.fetchedAt };
  } catch (e) {
    const kind: DataIssue = e instanceof SecError ? e.kind : "upstream";
    console.error(
      JSON.stringify({ event: "sec_financials_error", symbol, kind, message: e instanceof Error ? e.message : String(e) }),
    );
    return { ok: false, error: kind };
  }
}
