// Server-side: what analysts expect (FMP, licensed, so served behind the beta gate). Each part
// fails on its own. Plan restrictions and "no coverage" are stable for a day, so they are cached
// like data (no point spending the daily quota to hear the same answer); transient failures are not.
import { unstable_cache } from "next/cache";
import { isDemo } from "./data";
import { fmpAnalystEstimates, fmpGrades, fmpPriceTarget, type AnalystEstimate, type Grades, type PriceTarget } from "./fmp";
import type { DataIssue, Result } from "./types";

export interface AnalystsPayload {
  symbol: string;
  estimates: Result<AnalystEstimate[]>;
  target: Result<PriceTarget>;
  grades: Result<Grades>;
}

const STABLE: DataIssue[] = ["plan_restricted", "not_found"];

class Transient extends Error {
  constructor(readonly payload: AnalystsPayload) {
    super("analysts:transient");
  }
}

async function load(symbol: string): Promise<AnalystsPayload> {
  const [estimates, target, grades] = await Promise.all([fmpAnalystEstimates(symbol), fmpPriceTarget(symbol), fmpGrades(symbol)]);
  const payload = { symbol, estimates, target, grades };
  if ([estimates, target, grades].some((r) => !r.ok && !STABLE.includes(r.error))) throw new Transient(payload);
  return payload;
}

const cached = unstable_cache(load, ["fmp-analysts-v1"], { revalidate: 86_400, tags: ["fmp"] });

export async function getAnalysts(symbol: string): Promise<Result<AnalystsPayload>> {
  if (isDemo()) return { ok: false, error: "not_configured" }; // no simulated analyst numbers, ever
  const fetchedAt = new Date().toISOString();
  try {
    return { ok: true, data: await cached(symbol), fetchedAt };
  } catch (e) {
    if (e instanceof Transient) return { ok: true, data: e.payload, fetchedAt }; // shown now, retried next time
    console.error(JSON.stringify({ event: "analysts_error", symbol, message: e instanceof Error ? e.message : String(e) }));
    return { ok: false, error: "upstream" };
  }
}
