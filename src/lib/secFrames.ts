// SEC XBRL "frames": one request returns every filer's value for a concept in a calendar
// period. Used to build peer distributions without one request per company.
import { INPUT_KEYS, type RatioInputs } from "./ratios";
import { ALT_TOLERANCE, LINES, type LineKey } from "./secFinancials";

export interface FramePoint {
  cik: number;
  val: number;
}

interface FrameSpec {
  input: keyof RatioInputs;
  concepts: string[]; // first concept with a value for a company wins, as in the statements
  uom: string;
  period: "year" | "prevYear" | "yearEnd";
  largest?: boolean; // revenue: the largest candidate wins, as in the statements
  fallback?: string[];
}

const chain = (key: LineKey) => LINES.find((l) => l.key === key)!.concepts;
const revenue = LINES.find((l) => l.key === "revenue")!;

export const FRAME_SPECS: FrameSpec[] = [
  { input: "revenue", concepts: revenue.concepts, fallback: revenue.fallback, largest: true, uom: "USD", period: "year" },
  { input: "revenuePrev", concepts: revenue.concepts, fallback: revenue.fallback, largest: true, uom: "USD", period: "prevYear" },
  { input: "grossProfit", concepts: chain("grossProfit"), uom: "USD", period: "year" },
  { input: "costOfRevenue", concepts: chain("costOfRevenue"), uom: "USD", period: "year" },
  { input: "operatingIncome", concepts: chain("operatingIncome"), uom: "USD", period: "year" },
  { input: "netIncome", concepts: chain("netIncome"), uom: "USD", period: "year" },
  { input: "eps", concepts: chain("epsDiluted"), uom: "USD-per-shares", period: "year" },
  { input: "epsPrev", concepts: chain("epsDiluted"), uom: "USD-per-shares", period: "prevYear" },
  { input: "ocf", concepts: chain("operatingCashFlow"), uom: "USD", period: "year" },
  { input: "capex", concepts: chain("capex"), uom: "USD", period: "year" },
  { input: "equity", concepts: chain("equity"), uom: "USD", period: "yearEnd" },
  { input: "assets", concepts: chain("totalAssets"), uom: "USD", period: "yearEnd" },
  { input: "longTermDebt", concepts: chain("longTermDebt"), uom: "USD", period: "yearEnd" },
  // For comps: enterprise value (debt − cash) and EBITDA (operating income + D&A).
  { input: "currentDebt", concepts: chain("currentDebt"), uom: "USD", period: "yearEnd" },
  { input: "cash", concepts: chain("cash"), uom: "USD", period: "yearEnd" },
  { input: "depreciation", concepts: chain("depreciation"), uom: "USD", period: "year" },
];

/** Frame period code: annual flows use CY2025, balances at year end use CY2025Q4I. */
export function framePeriod(spec: Pick<FrameSpec, "period">, year: number): string {
  if (spec.period === "prevYear") return `CY${year - 1}`;
  if (spec.period === "yearEnd") return `CY${year}Q4I`;
  return `CY${year}`;
}

export function frameUrl(concept: string, uom: string, period: string): string {
  return `https://data.sec.gov/api/xbrl/frames/us-gaap/${concept}/${uom}/${period}.json`;
}

/** Valid points of a frames payload; throws on an unexpected shape. */
export function parseFrame(json: unknown): FramePoint[] {
  const data = (json as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) throw new Error("sec: unexpected frames payload");
  const out: FramePoint[] = [];
  for (const d of data as { cik?: unknown; val?: unknown }[]) {
    const cik = d?.cik;
    const val = d?.val;
    // Strict types: Number(null) would turn a missing value into 0.
    if (typeof cik === "number" && Number.isInteger(cik) && cik > 0 && typeof val === "number" && Number.isFinite(val)) {
      out.push({ cik, val });
    }
  }
  return out;
}

/**
 * Most recent calendar year with near-complete coverage. A year's frame fills up as
 * annual reports arrive (most by March), so it is used once it has ≥ 90 % of the
 * previous year's filers.
 */
export function pickReferenceYear(counts: { year: number; pts: number }[]): number | null {
  const sorted = [...counts].sort((a, b) => b.year - a.year);
  for (let i = 0; i < sorted.length - 1; i++) {
    const prev = sorted.find((c) => c.year === sorted[i].year - 1);
    if (prev && sorted[i].pts >= prev.pts * 0.9) return sorted[i].year;
  }
  return sorted.length ? sorted[sorted.length - 1].year : null;
}

export type FetchJson = (url: string) => Promise<unknown>;

/**
 * Inputs per company for one year. Frames that 404 (concept unused that year) are skipped;
 * any other failure aborts, so a partial refresh never replaces good data. Revenue follows
 * the statements' rule (largest candidate); competing totals set `revenueAmbiguous`.
 */
export async function collectYear(year: number, fetchJson: FetchJson, keep?: Set<number>): Promise<Map<number, RatioInputs>> {
  const byCik = new Map<number, RatioInputs>();
  const inputsOf = (cik: number) => {
    const i = byCik.get(cik) ?? {};
    byCik.set(cik, i);
    return i;
  };
  const load = async (concept: string, spec: FrameSpec): Promise<FramePoint[]> => {
    try {
      const points = parseFrame(await fetchJson(frameUrl(concept, spec.uom, framePeriod(spec, year))));
      return keep ? points.filter((p) => keep.has(p.cik)) : points;
    } catch (e) {
      if ((e as { status?: number }).status === 404) return [];
      throw e;
    }
  };

  for (const spec of FRAME_SPECS) {
    if (!spec.largest) {
      for (const concept of [...spec.concepts, ...(spec.fallback ?? [])]) {
        for (const p of await load(concept, spec)) {
          const inputs = inputsOf(p.cik);
          if (inputs[spec.input] === undefined) inputs[spec.input] = p.val;
        }
      }
      continue;
    }
    const cands = new Map<number, number[]>();
    for (const concept of spec.concepts) {
      for (const p of await load(concept, spec)) cands.set(p.cik, [...(cands.get(p.cik) ?? []), p.val]);
    }
    for (const [cik, vals] of cands) {
      const best = Math.max(...vals);
      const inputs = inputsOf(cik);
      inputs[spec.input] = best;
      if (vals.some((v) => v > 0 && Math.abs(best - v) > Math.abs(best) * ALT_TOLERANCE)) inputs.revenueAmbiguous = 1;
    }
    for (const concept of spec.fallback ?? []) {
      for (const p of await load(concept, spec)) {
        if (cands.has(p.cik)) continue;
        const inputs = inputsOf(p.cik);
        if (inputs[spec.input] === undefined) inputs[spec.input] = p.val;
      }
    }
  }
  return byCik;
}

/** Drops anything that isn't a known numeric input (jsonb read back from the database). */
export function cleanInputs(raw: unknown): RatioInputs {
  const out: RatioInputs = {};
  if (!raw || typeof raw !== "object") return out;
  for (const k of INPUT_KEYS) {
    const v = (raw as Record<string, unknown>)[k];
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  }
  return out;
}
