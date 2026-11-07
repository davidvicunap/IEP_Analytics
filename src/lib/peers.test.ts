import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import type { Db } from "@/db/client";
import { backfillSic, ensureSic, latestMetricsYear, peerInputs, refreshCompanyMetrics } from "./peers";
import { assembleRatios, sectorComparison } from "./ratiosData";
import type { StatementSet } from "./secFinancials";

let db: Db;
const notFound = () => Object.assign(new Error("404"), { status: 404 });

beforeAll(async () => {
  const pg = drizzle(new PGlite(), { schema });
  await migrate(pg, { migrationsFolder: "./drizzle" });
  db = pg as unknown as Db;
  // Ranks follow the SEC list (largest first). GOOG/GOOGL share one CIK.
  await db.insert(schema.securities).values([
    { symbol: "BIG", cik: 1, name: "Big", rank: 0 },
    { symbol: "GOOGL", cik: 2, name: "Two A", rank: 1 },
    { symbol: "GOOG", cik: 2, name: "Two C", rank: 5 },
    { symbol: "MID", cik: 3, name: "Mid", rank: 2 },
    { symbol: "GONE", cik: 4, name: "Gone", rank: 3, active: false },
    { symbol: "NOSUB", cik: 5, name: "No submissions", rank: 4 },
  ]);
});

describe("SIC codes", () => {
  const sics: Record<number, number> = { 1: 3571, 2: 7370, 3: 3572 };
  const calls: number[] = [];
  const fetchJson = async (url: string) => {
    const cik = Number(url.match(/CIK(\d+)/)![1]);
    calls.push(cik);
    if (!(cik in sics)) throw notFound();
    return { sic: String(sics[cik]), sicDescription: `SIC ${sics[cik]}` };
  };

  it("fills active companies largest first, once per CIK, and records 404s as checked", async () => {
    const r = await backfillSic(db, 10_000, fetchJson);
    expect(calls).toEqual([1, 2, 3, 5]);
    expect(r).toEqual({ filled: 4, remaining: 0 });
    const rows = await db.select().from(schema.securities).where(eq(schema.securities.cik, 2));
    expect(rows.map((x) => x.sic)).toEqual([7370, 7370]); // both share classes
    const [nosub] = await db.select().from(schema.securities).where(eq(schema.securities.cik, 5));
    expect(nosub.sic).toBeNull();
    expect(nosub.sicCheckedAt).not.toBeNull();
  });

  it("doesn't fetch again once checked", async () => {
    calls.length = 0;
    expect(await ensureSic(db, 1, fetchJson)).toEqual({ sic: 3571, sicDescription: "SIC 3571" });
    expect(calls).toEqual([]);
  });

  it("stops at the first non-404 error and resumes later", async () => {
    await db.update(schema.securities).set({ sicCheckedAt: null });
    const failing = async () => {
      throw Object.assign(new Error("429"), { status: 429 });
    };
    expect(await backfillSic(db, 10_000, failing)).toEqual({ filled: 0, remaining: 4 });
    await backfillSic(db, 10_000, fetchJson);
  });
});

describe("yearly peer inputs", () => {
  const frame = (points: [number, number][]) => ({ data: points.map(([cik, val]) => ({ cik, val })) });
  const fetchJson = async (url: string) => {
    if (url.endsWith("NetIncomeLoss/USD/CY2025.json")) return frame([[1, 90], [2, 20], [3, 5], [99, 1]]);
    if (url.endsWith("NetIncomeLoss/USD/CY2024.json")) return frame([[1, 80], [2, 18], [3, 4], [99, 1]]);
    if (url.endsWith("Revenues/USD/CY2025.json")) return frame([[1, 400], [2, 100], [3, 50], [99, 10]]);
    if (url.endsWith("StockholdersEquity/USD/CY2025Q4I.json")) return frame([[1, 300], [3, 25]]);
    throw notFound();
  };

  it("stores listed companies for the reference year", async () => {
    expect(await refreshCompanyMetrics(db, new Date("2026-11-07"), fetchJson)).toEqual({ year: 2025, companies: 3 });
    expect((await latestMetricsYear(db))?.year).toBe(2025);
  });

  it("returns peers in the same 2-digit SIC group, excluding the company", async () => {
    const peers = await peerInputs(db, 3571, 2025, 1);
    expect(peers).toEqual([{ cik: 3, sic: 3572, inputs: { revenue: 50, netIncome: 5, equity: 25 } }]);
  });
});

describe("assembleRatios", () => {
  const cell = (value: number | null) => ({ value });
  const years = Array.from({ length: 6 }, (_, k) => 2020 + k);
  const annual: StatementSet = {
    periods: years.map((y) => ({ end: `${y}-12-31`, label: `FY${y}` })),
    lines: {
      revenue: years.map((_, k) => cell(100 + 10 * k)),
      netIncome: years.map((_, k) => cell(10 + 2 * k)), // margin rises 10 % → 13.3 %
      equity: years.map(() => cell(100)),
    },
  };

  it("adds own-history percentiles and leaves sector empty with too few peers", async () => {
    const r = await assembleRatios(db, { symbol: "BIG", cik: 1, annual });
    expect(r).toMatchObject({ businessType: "general", sic: 3571, period: { label: "FY2025" }, peersYear: 2025 });
    const net = r.ratios.find((x) => x.key === "netMargin")!;
    expect(net.value).toBeCloseTo(20 / 150);
    expect(net.history).toHaveLength(6);
    expect(net.own).toMatchObject({ n: 6, percentile: 92 }); // highest of six: (5 + 0.5) / 6
    expect(net.sector).toBeNull(); // 1 peer < 10
    const gross = r.ratios.find((x) => x.key === "grossMargin")!;
    expect(gross.value).toBeNull();
  });
});

describe("sectorComparison", () => {
  const peer = (cik: number, sic: number, netIncome: number, amb = false) => ({
    cik, sic, inputs: { revenue: 100, netIncome, ...(amb ? { revenueAmbiguous: 1 } : {}) },
  });

  it("uses the 3-digit group with ≥ 15 peers, else the 2-digit group with ≥ 10", () => {
    const same = Array.from({ length: 15 }, (_, k) => peer(100 + k, 3571, k));
    expect(sectorComparison("netMargin", 0.2, 3571, same)).toMatchObject({ sicPrefix: "357", n: 15, percentile: 100 });
    const mixed = Array.from({ length: 12 }, (_, k) => peer(200 + k, k < 5 ? 3572 : 3661, k));
    expect(sectorComparison("netMargin", 0.2, 3571, mixed)).toMatchObject({ sicPrefix: "35", n: 12 });
    expect(sectorComparison("netMargin", 0.2, 3571, mixed.slice(0, 9))).toBeNull();
  });

  it("leaves peers with ambiguous revenue out of revenue-based ratios only", () => {
    const peers = Array.from({ length: 12 }, (_, k) => peer(300 + k, 3600, k, k < 3));
    expect(sectorComparison("netMargin", 0.05, 3571, peers)).toBeNull(); // 9 usable < 10
    const roe = peers.map((p) => ({ ...p, inputs: { ...p.inputs, equity: 50 } }));
    expect(sectorComparison("roe", 0.1, 3571, roe)).toMatchObject({ n: 12 });
  });
});

describe("assembleRatios with ambiguous revenue", () => {
  it("notes revenue-based ratios and skips their sector comparison", async () => {
    const years = Array.from({ length: 6 }, (_, k) => 2020 + k);
    const annual: StatementSet = {
      periods: years.map((y) => ({ end: `${y}-12-31`, label: `FY${y}` })),
      lines: {
        revenue: years.map((_, k) => ({
          value: 100 + k,
          ...(k === 5 ? { alt: { concept: "RevenueFromContractWithCustomerExcludingAssessedTax", value: 40 } } : {}),
        })),
        netIncome: years.map(() => ({ value: 10 })),
        equity: years.map(() => ({ value: 100 })),
      },
    };
    const r = await assembleRatios(db, { symbol: "BIG", cik: 1, annual });
    const net = r.ratios.find((x) => x.key === "netMargin")!;
    expect(net.note).toBe("revenueAmbiguous");
    expect(net.sector).toBeNull();
    expect(net.own).not.toBeNull(); // its own history is still shown
    expect(r.ratios.find((x) => x.key === "roe")!.note).toBeNull();
  });
});
