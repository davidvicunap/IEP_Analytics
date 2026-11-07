import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/db/schema";
import type { Db } from "@/db/client";
import type { Financials, StatementSet } from "./secFinancials";

vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));
let db: Db;
vi.mock("@/db/client", () => ({ getDb: () => db }));
const demo = { on: false };
vi.mock("./data", () => ({ getQuote: vi.fn(), isDemo: () => demo.on }));
vi.mock("./financials", () => ({ getFinancials: vi.fn() }));
vi.mock("./fmp", () => ({ fmpHistory: vi.fn(), fmpTreasury10y: vi.fn(), fmpEquityRiskPremium: vi.fn() }));

import { getQuote } from "./data";
import { getFinancials } from "./financials";
import { fmpEquityRiskPremium, fmpHistory, fmpTreasury10y } from "./fmp";
import { getValuation, revenueCagr5 } from "./valuationData";

const ok = <T,>(data: T) => ({ ok: true as const, data, fetchedAt: "2026-11-06T21:00:00.000Z" });
const cell = (value: number | null) => ({ value });

// 12 calendar quarters 2023Q4…2026Q3 (filed ~5 weeks after quarter end), flat figures:
// revenue 100, net income 10, FCF 8 per quarter → TTM 400 / 40 / 32; equity 500.
const qEnds = ["2023-12-31", "2024-03-31", "2024-06-30", "2024-09-30", "2024-12-31", "2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31", "2026-03-31", "2026-06-30", "2026-09-30"];
const fileDate = (end: string) => new Date(Date.parse(end) + 35 * 86_400_000).toISOString().slice(0, 10);
const quarterly: StatementSet = {
  periods: qEnds.map((end, i) => ({ end, filed: fileDate(end), label: `Q${(i % 4) + 1}` })),
  lines: {
    revenue: qEnds.map(() => cell(100)),
    netIncome: qEnds.map(() => cell(10)),
    freeCashFlow: qEnds.map(() => cell(8)),
    equity: qEnds.map(() => cell(500)),
  },
};
const annual: StatementSet = {
  periods: [2020, 2021, 2022, 2023, 2024, 2025].map((y) => ({ end: `${y}-12-31`, label: `FY${y}` })),
  lines: { revenue: [200, 220, 242, 266.2, 292.82, 322.102].map(cell) }, // +10 %/yr
};
const financials = (cik: number, symbol: string): Financials & { symbol: string; fetchedAt: string } => ({
  cik,
  symbol,
  entityName: symbol,
  annual,
  quarterly,
  shares: { points: [{ end: "2023-10-01", value: 10, filed: "2023-11-01" }], splits: [], reliableFrom: null },
  fetchedAt: "2026-11-06T00:00:00.000Z",
});
// Monthly closes for 36 months: price 40 → market cap 400 with 10 shares.
const candles = Array.from({ length: 36 }, (_, i) => {
  const d = new Date(Date.UTC(2023, 11 + i, 28));
  return { time: d.toISOString().slice(0, 10), open: 40, high: 40, low: 40, close: 40 + (i % 5), volume: 1 };
});

beforeAll(async () => {
  const pg = drizzle(new PGlite(), { schema });
  await migrate(pg, { migrationsFolder: "./drizzle" });
  db = pg as unknown as Db;
  const checked = new Date();
  await db.insert(schema.securities).values([
    { symbol: "ME", cik: 1, name: "Me", rank: 0, sic: 3571, sicCheckedAt: checked },
    { symbol: "BANK", cik: 2, name: "Bank", rank: 1, sic: 6021, sicCheckedAt: checked },
    ...Array.from({ length: 6 }, (_, k) => ({ symbol: `P${k}`, cik: 10 + k, name: `Peer ${k}`, rank: 2 + k, sic: 3572, sicCheckedAt: checked })),
  ]);
  await db.insert(schema.companyMetrics).values([
    { cik: 1, year: 2025, inputs: { netIncome: 40, revenue: 400, equity: 500 } },
    ...Array.from({ length: 6 }, (_, k) => ({ cik: 10 + k, year: 2025, inputs: { netIncome: 10, revenue: 100, equity: 50 } })),
  ]);
});

beforeEach(() => {
  demo.on = false;
  vi.mocked(getQuote).mockResolvedValue(ok({ symbol: "ME", name: "Me", price: 44, change: 0, changePercent: 0, marketCap: 440 }));
  vi.mocked(getFinancials).mockResolvedValue(ok(financials(1, "ME")));
  vi.mocked(fmpHistory).mockResolvedValue(ok(candles));
  vi.mocked(fmpTreasury10y).mockResolvedValue(ok({ value: 0.0486, date: "2026-11-06" }));
  vi.mocked(fmpEquityRiskPremium).mockResolvedValue(ok({ value: 0.0446, date: "2026-11-06" }));
});

describe("getValuation", () => {
  it("assembles multiples, the 5-year history analysis and DCF inputs", async () => {
    const r = await getValuation("ME");
    if (!r.ok) throw new Error(r.error);
    const v = r.data;
    const pe = v.multiples.find((m) => m.key === "pe")!;
    expect(pe.value).toBeCloseTo(11); // 440 / 40
    // Month-end caps 400…440 (closes 40…44 × 10 shares) over TTM net income 40 → P/E 10…11.
    expect(pe.own).toMatchObject({ verdict: "expensive", max: 11, min: 10 });
    expect(pe.own!.n).toBeGreaterThanOrEqual(24);
    expect(pe.own!.priceAtMedian).toBeCloseTo((44 * pe.own!.median) / 11);
    // DCF maker inputs: TTM base, beta vs the market (same series in this mock → exactly 1), rates
    expect(v.maker).toMatchObject({ issue: null, base: { revenue0: 400, marketCap: 440, price: 44 }, rf: { value: 0.0486 }, erp: { value: 0.0446 } });
    expect(v.maker.beta?.value).toBeCloseTo(1);
    expect(v.maker.data?.revenueCagr5).toBeCloseTo(0.1);
    expect(v.maker.defaults).toMatchObject({ rf: 0.0486, erp: 0.0446, terminal: "gordon", growth: [0.1, 0.085, 0.07, 0.055, 0.04] });
    expect(v.history.issue).toBeNull();
  });

  it("skips history when SEC shares don't match the quote (e.g. several share classes)", async () => {
    vi.mocked(getQuote).mockResolvedValue(ok({ symbol: "ME", name: "Me", price: 44, change: 0, changePercent: 0, marketCap: 880 }));
    const r = await getValuation("ME");
    if (!r.ok) throw new Error(r.error);
    expect(r.data.history.issue).toBe("sharesMismatch");
    expect(r.data.monthly).toEqual([]);
    expect(r.data.multiples.every((m) => m.own === null)).toBe(true);
  });

  it("uses bank metrics and no FCF model for banks", async () => {
    vi.mocked(getFinancials).mockResolvedValue(ok(financials(2, "BANK")));
    const r = await getValuation("BANK");
    if (!r.ok) throw new Error(r.error);
    expect(r.data.businessType).toBe("bank");
    expect(r.data.multiples.filter((m) => m.applicable).map((m) => m.key)).toEqual(["pe", "pb"]);
    expect(r.data.maker.issue).toBe("notApplicable");
    expect(r.data.maker.defaults).toBeNull();
  });

  it("leaves the DCF rate empty when the rates are unavailable", async () => {
    vi.mocked(fmpTreasury10y).mockResolvedValue({ ok: false, error: "plan_restricted" });
    const r = await getValuation("ME");
    if (!r.ok) throw new Error(r.error);
    expect(r.data.maker.ratesIssue).toBe("plan_restricted");
    expect(r.data.maker.conventions).toContain("rf"); // the default rate is then a stated convention
  });

  it("refuses to mix simulated prices with real filings in demo mode", async () => {
    demo.on = true;
    expect(await getValuation("ME")).toEqual({ ok: false, error: "not_configured" });
  });

  it("passes through quote errors such as plan restrictions", async () => {
    vi.mocked(getQuote).mockResolvedValue({ ok: false, error: "plan_restricted" });
    expect(await getValuation("ME")).toEqual({ ok: false, error: "plan_restricted" });
  });
});

describe("revenueCagr5", () => {
  it("needs exactly five fiscal years between the endpoints", () => {
    expect(revenueCagr5(annual)).toBeCloseTo(0.1);
    expect(revenueCagr5({ ...annual, periods: annual.periods.map((p, i) => (i === 0 ? { ...p, end: "2019-12-31" } : p)) })).toBeNull();
  });
});
