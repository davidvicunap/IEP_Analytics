// Stock screener over every listed company's yearly SEC figures (the same inputs and
// formulas as the ratios on each stock page). Pure: rows, filters, presets and sorting.
// The data comes from screenerData.ts; the page keeps the filters in the URL.
import { applies, businessType, computeRatios, REVENUE_BASED, type BusinessType, type RatioInputs, type RatioKey } from "./ratios";

/** Ratios offered as filters and columns. */
export const SCREEN_RATIOS = ["revenueGrowth", "grossMargin", "operatingMargin", "netMargin", "fcfMargin", "roic", "roe", "debtToEquity", "epsGrowth"] as const;
export type ScreenRatio = (typeof SCREEN_RATIOS)[number];

/** Filters where lower is better are maximums; the rest are minimums. */
export const MAX_FILTERS = new Set<ScreenRatio>(["debtToEquity"]);

/** URL parameter for each ratio (short, so links stay readable). */
export const PARAM: Record<ScreenRatio, string> = {
  revenueGrowth: "rg",
  grossMargin: "gm",
  operatingMargin: "om",
  netMargin: "nm",
  fcfMargin: "fcf",
  roic: "roic",
  roe: "roe",
  debtToEquity: "de",
  epsGrowth: "eg",
};

/** Debt/equity is a plain multiple; everything else is a percentage in the URL and the UI. */
export const isPercent = (k: ScreenRatio) => k !== "debtToEquity";

/** /api/sec/screener response. */
export interface ScreenerPayload {
  year: number;
  updatedAt: string;
  total: number; // companies with SEC figures for the year
  matched: number;
  rows: ScreenRow[]; // first 100 matches, sorted
}

export interface ScreenRow {
  symbol: string;
  name: string;
  cik: number;
  rank: number | null; // position in the SEC list, which is ordered by market value
  sic: number | null;
  industry: string | null;
  type: BusinessType;
  revenue: number | null;
  ratios: Record<ScreenRatio, number | null>;
}

/** SIC divisions (by 2-digit major group), for a coarse sector filter. */
export const DIVISIONS = ["agriculture", "mining", "construction", "manufacturing", "transport", "wholesale", "retail", "finance", "services", "public"] as const;
export type Division = (typeof DIVISIONS)[number];

export function divisionOf(sic: number | null): Division | null {
  if (!sic) return null;
  const g = Math.floor(sic / 100);
  if (g <= 9) return "agriculture";
  if (g <= 14) return "mining";
  if (g <= 17) return "construction";
  if (g <= 39) return "manufacturing";
  if (g <= 49) return "transport";
  if (g <= 51) return "wholesale";
  if (g <= 59) return "retail";
  if (g <= 67) return "finance";
  if (g <= 89) return "services";
  return "public";
}

/**
 * One row per company. Ratios that don't apply to its business type (e.g. margins for a
 * bank) or rest on an ambiguous revenue figure are left empty, so they never pass a filter.
 */
export function screenRow(s: { symbol: string; name: string; cik: number; rank: number | null; sic: number | null; industry: string | null }, inputs: RatioInputs): ScreenRow {
  const type = businessType(s.sic);
  const all = computeRatios(inputs);
  const ratios = {} as Record<ScreenRatio, number | null>;
  for (const k of SCREEN_RATIOS) {
    const usable = applies(k as RatioKey, type) && !(REVENUE_BASED.has(k as RatioKey) && inputs.revenueAmbiguous);
    const equityBased = (k === "roe" || k === "roic" || k === "debtToEquity") && !(typeof inputs.equity === "number" && inputs.equity > 0);
    ratios[k] = usable && !equityBased ? all[k as RatioKey] : null;
  }
  return { ...s, type, revenue: typeof inputs.revenue === "number" && !inputs.revenueAmbiguous ? inputs.revenue : null, ratios };
}

export type Size = "100" | "500" | "1000" | "all";
export const SIZES: Size[] = ["100", "500", "1000", "all"];
export type SortKey = ScreenRatio | "revenue" | "rank" | "symbol";

export interface Screen {
  bounds: Partial<Record<ScreenRatio, number>>; // fractions (0.15 = 15 %), or the multiple for debt/equity
  division: Division | null;
  industry: string; // text contained in the SEC industry name
  size: Size;
  sort: SortKey;
  dir: "asc" | "desc";
}

export const EMPTY_SCREEN: Screen = { bounds: {}, division: null, industry: "", size: "1000", sort: "rank", dir: "asc" };

/** Ready-made screens. Descriptive, not advice: each one is just a set of thresholds. */
export const PRESETS: Record<"quality" | "growth" | "cash" | "balance", Partial<Screen>> = {
  quality: { bounds: { roic: 0.15, grossMargin: 0.4, debtToEquity: 0.5, fcfMargin: 0.1 }, sort: "roic", dir: "desc" },
  growth: { bounds: { revenueGrowth: 0.15, operatingMargin: 0.1 }, sort: "revenueGrowth", dir: "desc" },
  cash: { bounds: { fcfMargin: 0.2 }, sort: "fcfMargin", dir: "desc" },
  balance: { bounds: { debtToEquity: 0.3, netMargin: 0.05 }, sort: "debtToEquity", dir: "asc" },
};

const SORTS = new Set<SortKey>([...SCREEN_RATIOS, "revenue", "rank", "symbol"]);

/** Reads a screen from URL parameters; anything invalid is ignored. */
export function parseScreen(p: URLSearchParams): Screen {
  const bounds: Screen["bounds"] = {};
  for (const k of SCREEN_RATIOS) {
    const raw = p.get(PARAM[k]);
    if (raw === null || raw.trim() === "") continue;
    const n = Number(raw);
    if (!Number.isFinite(n) || Math.abs(n) > 100_000) continue;
    bounds[k] = isPercent(k) ? n / 100 : n;
  }
  const division = (DIVISIONS as readonly string[]).includes(p.get("sector") ?? "") ? (p.get("sector") as Division) : null;
  const size = (SIZES as string[]).includes(p.get("size") ?? "") ? (p.get("size") as Size) : EMPTY_SCREEN.size;
  const sort = SORTS.has(p.get("sort") as SortKey) ? (p.get("sort") as SortKey) : EMPTY_SCREEN.sort;
  const dir = p.get("dir") === "desc" ? "desc" : p.get("dir") === "asc" ? "asc" : sort === "rank" || sort === "symbol" || sort === "debtToEquity" ? "asc" : "desc";
  return { bounds, division, industry: (p.get("q") ?? "").trim().slice(0, 60), size, sort, dir };
}

const round = (x: number) => Math.round(x * 1e6) / 1e6;

export function writeScreen(s: Screen): string {
  const p = new URLSearchParams();
  for (const k of SCREEN_RATIOS) {
    const v = s.bounds[k];
    if (v !== undefined) p.set(PARAM[k], String(isPercent(k) ? round(v * 100) : round(v)));
  }
  if (s.division) p.set("sector", s.division);
  if (s.industry) p.set("q", s.industry);
  if (s.size !== EMPTY_SCREEN.size) p.set("size", s.size);
  if (s.sort !== EMPTY_SCREEN.sort) p.set("sort", s.sort);
  if (s.dir !== (s.sort === "rank" || s.sort === "symbol" || s.sort === "debtToEquity" ? "asc" : "desc")) p.set("dir", s.dir);
  return p.toString();
}

export function passes(row: ScreenRow, s: Screen): boolean {
  if (s.size !== "all" && (row.rank === null || row.rank > Number(s.size))) return false;
  if (s.division && divisionOf(row.sic) !== s.division) return false;
  if (s.industry && !(row.industry ?? "").toLowerCase().includes(s.industry.toLowerCase())) return false;
  for (const k of SCREEN_RATIOS) {
    const bound = s.bounds[k];
    if (bound === undefined) continue;
    const v = row.ratios[k];
    if (v === null) return false; // no figure: it can't be shown to meet the condition
    if (MAX_FILTERS.has(k) ? v > bound : v < bound) return false;
  }
  return true;
}

/** Matching rows, sorted; empty values always last. */
export function runScreen(rows: ScreenRow[], s: Screen, limit = 100): { matched: number; rows: ScreenRow[] } {
  const hits = rows.filter((r) => passes(r, s));
  const value = (r: ScreenRow): number | string | null =>
    s.sort === "symbol" ? r.symbol : s.sort === "rank" ? r.rank : s.sort === "revenue" ? r.revenue : r.ratios[s.sort];
  const sign = s.dir === "asc" ? 1 : -1;
  hits.sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    if (va === null && vb === null) return a.symbol.localeCompare(b.symbol);
    if (va === null) return 1;
    if (vb === null) return -1;
    const c = typeof va === "string" ? va.localeCompare(vb as string) : (va as number) - (vb as number);
    return c !== 0 ? sign * c : a.symbol.localeCompare(b.symbol);
  });
  return { matched: hits.length, rows: hits.slice(0, limit) };
}
