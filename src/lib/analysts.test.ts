import { beforeEach, describe, expect, it, vi } from "vitest";

const cache = new Map<string, unknown>();
// A tiny stand-in for Next's cache: remembers what the function returned, never what it threw.
vi.mock("next/cache", () => ({
  unstable_cache:
    (fn: (s: string) => Promise<unknown>) =>
    async (s: string) => {
      if (cache.has(s)) return cache.get(s);
      const v = await fn(s);
      cache.set(s, v);
      return v;
    },
}));
const demo = { on: false };
vi.mock("./data", () => ({ isDemo: () => demo.on }));
vi.mock("./fmp", () => ({ fmpAnalystEstimates: vi.fn(), fmpPriceTarget: vi.fn(), fmpGrades: vi.fn() }));

import { getAnalysts } from "./analysts";
import { expectedGrowth } from "./expectations";
import { fmpAnalystEstimates, fmpGrades, fmpPriceTarget, type AnalystEstimate } from "./fmp";

const ok = <T,>(data: T) => ({ ok: true as const, data, fetchedAt: "2026-11-07T00:00:00.000Z" });
const fail = (error: "plan_restricted" | "rate_limited") => ({ ok: false as const, error });

beforeEach(() => {
  cache.clear();
  demo.on = false;
  vi.mocked(fmpAnalystEstimates).mockReset().mockResolvedValue(fail("plan_restricted"));
  vi.mocked(fmpPriceTarget).mockReset().mockResolvedValue(ok({ consensus: 300 }));
  vi.mocked(fmpGrades).mockReset().mockResolvedValue(ok({ strongBuy: 1, buy: 2, hold: 3, sell: 0, strongSell: 0 }));
});

describe("getAnalysts", () => {
  it("keeps each part's own answer and remembers a plan restriction for the day", async () => {
    const r = await getAnalysts("AAPL");
    expect(r.ok && r.data.estimates).toEqual({ ok: false, error: "plan_restricted" });
    expect(r.ok && r.data.target.ok).toBe(true);
    await getAnalysts("AAPL");
    expect(fmpAnalystEstimates).toHaveBeenCalledTimes(1); // no second call to hear the same "not in your plan"
  });

  it("shows a rate limit now but asks again next time", async () => {
    vi.mocked(fmpPriceTarget).mockResolvedValueOnce(fail("rate_limited"));
    const r = await getAnalysts("MSFT");
    expect(r.ok && r.data.target).toEqual({ ok: false, error: "rate_limited" });
    const again = await getAnalysts("MSFT");
    expect(again.ok && again.data.target.ok).toBe(true);
    expect(fmpPriceTarget).toHaveBeenCalledTimes(2);
  });

  it("never shows analyst numbers next to simulated prices", async () => {
    demo.on = true;
    expect(await getAnalysts("AAPL")).toEqual({ ok: false, error: "not_configured" });
  });
});

describe("expected growth", () => {
  // AAPL-like: SEC FY2026 revenue 478.8B; analysts' FY2026 row and three years ahead.
  const est: AnalystEstimate[] = [
    { date: "2026-09-27", revenue: { avg: 470e9 }, eps: { avg: 8.9 }, analystsEps: 30 },
    { date: "2027-09-27", revenue: { avg: 502.8e9 }, eps: { avg: 9.79 }, analystsEps: 28 },
    { date: "2028-09-27", revenue: { avg: 527.9e9 }, eps: { avg: 10.77 }, analystsEps: 20 },
    { date: "2029-09-27", revenue: { avg: 554.3e9 }, eps: { avg: 11.85 }, analystsEps: 9 },
    { date: "2030-09-27", revenue: { avg: 600e9 }, eps: { avg: 13 }, analystsEps: 2 },
  ];
  const g = expectedGrowth(est, { end: "2026-09-26", revenue: 478.8e9 });

  it("starts revenue from the SEC figure and EPS from the analysts' own base year", () => {
    expect(g.years.map((y) => y.date)).toEqual(["2027-09-27", "2028-09-27", "2029-09-27", "2030-09-27"]);
    expect(g.years[0].revenueGrowth).toBeCloseTo(502.8 / 478.8 - 1);
    expect(g.years[0].epsGrowth).toBeCloseTo(9.79 / 8.9 - 1);
    expect(g.years[1].revenueGrowth).toBeCloseTo(527.9 / 502.8 - 1);
  });

  it("summarises up to three years ahead as a yearly rate", () => {
    expect(g.revenueCagr?.years).toBe(3);
    expect(g.revenueCagr?.value).toBeCloseTo((554.3 / 478.8) ** (1 / 3) - 1);
    expect(g.epsCagr?.value).toBeCloseTo((11.85 / 8.9) ** (1 / 3) - 1);
  });

  it("leaves EPS growth out when the analysts' base year is missing", () => {
    const noBase = expectedGrowth(est.slice(1), { end: "2026-09-26", revenue: 478.8e9 });
    expect(noBase.years[0].epsGrowth).toBeNull();
    expect(noBase.epsCagr).toBeNull();
    expect(noBase.revenueCagr?.years).toBe(3);
  });
});
