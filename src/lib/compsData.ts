// Server-side: the data behind the interactive comps screen. The browser sends the peer list
// it wants (or none, to get suggestions) and recomputes every multiple itself.
//
// Market values are SEC share counts × price (marketCap.ts): no paid market-cap feed, and every
// value says which count and which price it rests on. Peer prices may be the day's stored close.
import { unstable_cache } from "next/cache";
import { getDb, type Db } from "@/db/client";
import { isDemo, recentPrices } from "./data";
import { marketCapFrom, parseCoverShares, type CoverShares, type MarketCap } from "./marketCap";
import { companyYearInputs, ensureSic, latestMetricsYear, suggestedPeers } from "./peers";
import { secJson } from "./sec";
import { businessType, type BusinessType, type RatioInputs } from "./ratios";
import { getSecurity } from "./securities";
import type { DataIssue, Result } from "./types";

export const MAX_PEERS = 15;
export const SUGGESTED_PEERS = 8;

export interface CompsCompanyData {
  symbol: string;
  name: string;
  sic: number | null;
  marketCap: number | null; // SEC shares × price; null when either is missing
  /** What the market value rests on: the share count (and its source) and the price (and its time). */
  marketCapBasis: MarketCap | null;
  inputs: RatioInputs | null; // fiscal-year SEC figures (same year for everyone)
}

/** Peer prices up to a day old are enough for comps (and spare the provider's daily quota). */
const PEER_PRICE_AGE_MS = 24 * 3_600_000;

const conceptUrl = (cik: number) =>
  `https://data.sec.gov/api/xbrl/companyconcept/CIK${String(cik).padStart(10, "0")}/dei/EntityCommonStockSharesOutstanding.json`;

/** The latest cover-page share count; null when the company doesn't tag one (404). Errors aren't cached. */
const coverShares = unstable_cache(
  async (cik: number): Promise<CoverShares | null> => {
    try {
      return parseCoverShares(await secJson(conceptUrl(cik)));
    } catch (e) {
      if ((e as { status?: number }).status === 404) return null;
      throw e;
    }
  },
  ["sec-cover-shares-v1"],
  { revalidate: 86_400, tags: ["sec"] },
);

async function coverOf(cik: number): Promise<CoverShares | null> {
  try {
    return await coverShares(cik);
  } catch (e) {
    console.error(JSON.stringify({ event: "cover_shares_error", cik, message: e instanceof Error ? e.message : String(e) }));
    return null;
  }
}

export interface CompsPayload {
  year: number;
  target: CompsCompanyData & { price: number; businessType: BusinessType; sicDescription: string | null };
  peers: CompsCompanyData[];
  suggested: boolean; // true when the list comes from the SIC group, not the user
  unknown: string[]; // requested symbols that aren't listed US companies
  /** Why some peers have no price (and so no market value), when that's the case. */
  marketCapsIssue: DataIssue | null;
  /** The peers without a price. */
  unpriced: string[];
}

async function sicOf(db: Db, cik: number): Promise<{ sic: number | null; sicDescription: string | null }> {
  try {
    return await ensureSic(db, cik);
  } catch {
    return { sic: null, sicDescription: null };
  }
}

export async function buildComps(db: Db, symbol: string, requested: string[] | null): Promise<Result<CompsPayload>> {
  const security = await getSecurity(db, symbol);
  if (!security) return { ok: false, error: "not_found" };
  // The company's own price: live when the provider answers, else its last stored price (dated).
  const own = (await recentPrices([security.symbol], 0)).get(security.symbol);
  if (!own || "error" in own) return { ok: false, error: own && "error" in own ? own.error : "upstream" };
  const latest = await latestMetricsYear(db);
  if (!latest) return { ok: false, error: "not_found" };
  const year = latest.year;
  const { sic, sicDescription } = await sicOf(db, security.cik);

  const targetInputs = await companyYearInputs(db, security.cik, year);
  let symbols: string[];
  if (requested) symbols = requested;
  else symbols = sic ? await suggestedPeers(db, sic, year, security.cik, SUGGESTED_PEERS, targetInputs?.revenue ?? null) : [];
  symbols = [...new Set(symbols.map((s) => s.toUpperCase()))].filter((s) => s !== security.symbol).slice(0, MAX_PEERS);

  const unknown: string[] = [];
  const found: { symbol: string; name: string; cik: number }[] = [];
  for (const s of symbols) {
    const sec = await getSecurity(db, s);
    if (sec) found.push(sec);
    else unknown.push(s);
  }
  const now = new Date();
  const prices = await recentPrices(found.map((p) => p.symbol), PEER_PRICE_AGE_MS, now.getTime());
  let pricesIssue: DataIssue | null = null;
  const unpriced: string[] = [];
  const peers = await Promise.all(
    found.map(async (p): Promise<CompsCompanyData> => {
      const [{ sic: peerSic }, inputs, cover] = await Promise.all([sicOf(db, p.cik), companyYearInputs(db, p.cik, year), coverOf(p.cik)]);
      const price = prices.get(p.symbol);
      if (!price || "error" in price) {
        unpriced.push(p.symbol);
        if (price) pricesIssue ??= price.error;
      }
      const basis = price && !("error" in price) ? marketCapFrom(price.price, price.at, cover, inputs, year, now) : null;
      return { symbol: p.symbol, name: p.name, sic: peerSic, marketCap: basis?.value ?? null, marketCapBasis: basis, inputs };
    }),
  );
  const targetBasis = marketCapFrom(own.price, own.at, await coverOf(security.cik), targetInputs, year, now);

  return {
    ok: true,
    fetchedAt: own.at,
    data: {
      year,
      target: {
        symbol: security.symbol,
        name: security.name,
        sic,
        sicDescription,
        businessType: businessType(sic),
        price: own.price,
        marketCap: targetBasis?.value ?? null,
        marketCapBasis: targetBasis,
        inputs: targetInputs,
      },
      peers,
      suggested: !requested,
      unknown,
      marketCapsIssue: pricesIssue,
      unpriced,
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
