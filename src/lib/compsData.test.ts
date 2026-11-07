import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/db/schema";
import type { Db } from "@/db/client";

vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));
vi.mock("./data", () => ({ getQuote: vi.fn(), isDemo: () => false }));
vi.mock("./fmp", () => ({ fmpMarketCaps: vi.fn() }));

import { getQuote } from "./data";
import { fmpMarketCaps } from "./fmp";
import { buildComps } from "./compsData";

let db: Db;
const ok = <T,>(data: T) => ({ ok: true as const, data, fetchedAt: "2026-11-06T21:00:00.000Z" });

beforeAll(async () => {
  const pg = drizzle(new PGlite(), { schema });
  await migrate(pg, { migrationsFolder: "./drizzle" });
  db = pg as unknown as Db;
  const checked = new Date();
  const rows = [
    { symbol: "ME", cik: 1, rank: 5, sic: 3571 },
    { symbol: "BIG2", cik: 2, rank: 1, sic: 3550 }, // same 2-digit group only
    { symbol: "CLOSE", cik: 3, rank: 9, sic: 3572 }, // same 3-digit group
    { symbol: "NODATA", cik: 4, rank: 2, sic: 3570 }, // no yearly inputs → never suggested
    { symbol: "FAR", cik: 5, rank: 0, sic: 7372 }, // other industry
  ];
  await db.insert(schema.securities).values(rows.map((r) => ({ ...r, name: r.symbol, sicCheckedAt: checked })));
  await db.insert(schema.companyMetrics).values(
    [1, 2, 3, 5].map((cik) => ({ cik, year: 2025, inputs: { revenue: 100 * cik, netIncome: 10 * cik } })),
  );
});

beforeEach(() => {
  vi.mocked(getQuote).mockResolvedValue(ok({ symbol: "ME", name: "Me", price: 10, change: 0, changePercent: 0, marketCap: 1000 }));
  vi.mocked(fmpMarketCaps).mockResolvedValue(ok({ CLOSE: 5000 })); // the plan prices only one of them
});

describe("buildComps", () => {
  it("suggests peers with data, same 3-digit SIC first, and keeps unpriced ones without a market cap", async () => {
    const r = await buildComps(db, "ME", null);
    if (!r.ok) throw new Error(r.error);
    expect(r.data.suggested).toBe(true);
    expect(r.data.peers.map((p) => p.symbol)).toEqual(["CLOSE", "BIG2"]);
    expect(r.data.peers.map((p) => p.marketCap)).toEqual([5000, null]);
    expect(r.data.target).toMatchObject({ symbol: "ME", price: 10, marketCap: 1000, inputs: { revenue: 100 }, businessType: "general" });
    expect(r.data.year).toBe(2025);
  });

  it("uses the user's list, reports unknown tickers and allows other industries", async () => {
    const r = await buildComps(db, "ME", ["far", "NOPE", "ME", "FAR"]);
    if (!r.ok) throw new Error(r.error);
    expect(r.data.suggested).toBe(false);
    expect(r.data.peers.map((p) => p.symbol)).toEqual(["FAR"]);
    expect(r.data.unknown).toEqual(["NOPE"]);
  });

  it("reports a plan error on market caps without failing the whole screen", async () => {
    vi.mocked(fmpMarketCaps).mockResolvedValue({ ok: false, error: "plan_restricted" });
    const r = await buildComps(db, "ME", null);
    if (!r.ok) throw new Error(r.error);
    expect(r.data.marketCapsIssue).toBe("plan_restricted");
    expect(r.data.peers.every((p) => p.marketCap === null)).toBe(true);
  });

  it("returns not_found for unknown targets", async () => {
    expect(await buildComps(db, "ZZZZ", null)).toEqual({ ok: false, error: "not_found" });
  });
});
