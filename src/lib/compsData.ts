// Server-side: the data behind the interactive comps screen. The browser sends the peer list
// it wants (or none, to get suggestions) and recomputes every multiple itself.
import { getDb, type Db } from "@/db/client";
import { getQuote, isDemo } from "./data";
import { fmpMarketCaps } from "./fmp";
import { companyYearInputs, ensureSic, latestMetricsYear, listedPeers } from "./peers";
import { businessType, type BusinessType, type RatioInputs } from "./ratios";
import { getSecurity } from "./securities";
import type { DataIssue, Result } from "./types";

export const MAX_PEERS = 15;
export const SUGGESTED_PEERS = 8;

export interface CompsCompanyData {
  symbol: string;
  name: string;
  sic: number | null;
  marketCap: number | null; // from the data provider; null when the plan doesn't cover it
  inputs: RatioInputs | null; // fiscal-year SEC figures (same year for everyone)
}

export interface CompsPayload {
  year: number;
  target: CompsCompanyData & { price: number; businessType: BusinessType; sicDescription: string | null };
  peers: CompsCompanyData[];
  suggested: boolean; // true when the list comes from the SIC group, not the user
  unknown: string[]; // requested symbols that aren't listed US companies
  marketCapsIssue: DataIssue | null;
}

async function sicOf(db: Db, cik: number): Promise<{ sic: number | null; sicDescription: string | null }> {
  try {
    return await ensureSic(db, cik);
  } catch {
    return { sic: null, sicDescription: null };
  }
}

/** Largest listed peers, same 3-digit SIC first, then the rest of the 2-digit group. */
async function suggestions(db: Db, sic: number, year: number, cik: number) {
  const pool = await listedPeers(db, sic, year, cik, 40);
  const close = pool.filter((p) => Math.floor(p.sic / 10) === Math.floor(sic / 10));
  const rest = pool.filter((p) => Math.floor(p.sic / 10) !== Math.floor(sic / 10));
  return [...close, ...rest].slice(0, SUGGESTED_PEERS).map((p) => p.symbol);
}

export async function buildComps(db: Db, symbol: string, requested: string[] | null): Promise<Result<CompsPayload>> {
  const security = await getSecurity(db, symbol);
  if (!security) return { ok: false, error: "not_found" };
  const quote = await getQuote(security.symbol);
  if (!quote.ok) return quote;
  const latest = await latestMetricsYear(db);
  if (!latest) return { ok: false, error: "not_found" };
  const year = latest.year;
  const { sic, sicDescription } = await sicOf(db, security.cik);

  let symbols: string[];
  if (requested) symbols = requested;
  else symbols = sic ? await suggestions(db, sic, year, security.cik) : [];
  symbols = [...new Set(symbols.map((s) => s.toUpperCase()))].filter((s) => s !== security.symbol).slice(0, MAX_PEERS);

  const unknown: string[] = [];
  const found: { symbol: string; name: string; cik: number }[] = [];
  for (const s of symbols) {
    const sec = await getSecurity(db, s);
    if (sec) found.push(sec);
    else unknown.push(s);
  }
  const caps = await fmpMarketCaps(found.map((p) => p.symbol));
  const peers: CompsCompanyData[] = [];
  for (const p of found) {
    peers.push({
      symbol: p.symbol,
      name: p.name,
      sic: (await sicOf(db, p.cik)).sic,
      marketCap: caps.ok ? (caps.data[p.symbol] ?? null) : null,
      inputs: await companyYearInputs(db, p.cik, year),
    });
  }

  return {
    ok: true,
    fetchedAt: quote.fetchedAt,
    data: {
      year,
      target: {
        symbol: security.symbol,
        name: security.name,
        sic,
        sicDescription,
        businessType: businessType(sic),
        price: quote.data.price,
        marketCap: quote.data.marketCap ?? null,
        inputs: await companyYearInputs(db, security.cik, year),
      },
      peers,
      suggested: !requested,
      unknown,
      marketCapsIssue: caps.ok ? null : caps.error,
    },
  };
}

export async function getComps(symbol: string, requested: string[] | null): Promise<Result<CompsPayload>> {
  const db = getDb();
  if (!db || isDemo()) return { ok: false, error: "not_configured" };
  try {
    return await buildComps(db, symbol, requested);
  } catch (e) {
    console.error(JSON.stringify({ event: "comps_error", symbol, message: e instanceof Error ? e.message : String(e) }));
    return { ok: false, error: "upstream" };
  }
}
