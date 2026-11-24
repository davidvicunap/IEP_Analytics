import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/db/schema";
import type { Db } from "@/db/client";

vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));
vi.mock("./data", () => ({ isDemo: () => false, recentPrices: vi.fn() }));
vi.mock("./sec", async (orig) => ({ ...(await orig<typeof import("./sec")>()), secJson: vi.fn() }));

import { recentPrices } from "./data";
import { secJson } from "./sec";
import { buildComps } from "./compsData";

let db: Db;
const at = "2026-11-06T21:00:00.000Z";
const cover = (val: number) => ({ units: { shares: [{ end: "2026-10-17", val, accn: "0000000000-26-000001", form: "10-K", filed: "2026-10-30" }] } });
const notFound = Object.assign(new Error("404"), { status: 404 });

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-07T12:00:00Z"));
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
    [1, 2, 3, 5].map((cik) => ({ cik, year: 2025, inputs: { revenue: 100 * cik, netIncome: 10 * cik, eps: 0.5 } })),
  );
});

afterAll(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.mocked(recentPrices).mockResolvedValue(
    new Map([
      ["ME", { price: 10, at, stored: false }],
      ["CLOSE", { price: 20, at, stored: true }],
      ["BIG2", { error: "rate_limited" as const }],
      ["FAR", { price: 5, at, stored: false }],
    ]),
  );
  vi.mocked(secJson).mockImplementation(async (url: string) => {
    if (url.includes("CIK0000000001")) return cover(100);
    if (url.includes("CIK0000000003")) return cover(500);
    throw notFound;
  });
});

describe("buildComps", () => {
  it("suggests peers with data, closest industry first; market value = SEC cover shares × price", async () => {
    const r = await buildComps(db, "ME", null);
    if (!r.ok) throw new Error(r.error);
    expect(r.data.suggested).toBe(true);
    expect(r.data.peers.map((p) => p.symbol)).toEqual(["CLOSE", "BIG2"]);
    const [close, big2] = r.data.peers;
    expect(close.marketCap).toBe(10_000);
    expect(close.marketCapBasis).toMatchObject({ shares: 500, sharesSource: "cover", sharesAsOf: "2026-10-17", price: 20, priceAt: at });
    // No price for BIG2: no market value, and the reason is reported, not hidden.
    expect(big2.marketCap).toBeNull();
    expect(r.data.marketCapsIssue).toBe("rate_limited");
    expect(r.data.unpriced).toEqual(["BIG2"]);
    // The target too: its own SEC count, not the provider's market cap.
    expect(r.data.target).toMatchObject({ symbol: "ME", price: 10, marketCap: 1000, inputs: { revenue: 100 }, businessType: "general" });
    expect(r.data.year).toBe(2025);
  });

  it("without a cover count, uses diluted shares (net income ÷ EPS) and says so", async () => {
    vi.mocked(secJson).mockRejectedValue(notFound);
    const r = await buildComps(db, "ME", ["FAR"]);
    if (!r.ok) throw new Error(r.error);
    expect(r.data.peers[0].marketCapBasis).toMatchObject({ shares: 100, sharesSource: "diluted", sharesAsOf: "FY2025" });
    expect(r.data.target.marketCap).toBe(200);
  });

  it("uses the user's list, reports unknown tickers and allows other industries", async () => {
    const r = await buildComps(db, "ME", ["far", "NOPE", "ME", "FAR"]);
    if (!r.ok) throw new Error(r.error);
    expect(r.data.suggested).toBe(false);
    expect(r.data.peers.map((p) => p.symbol)).toEqual(["FAR"]);
    expect(r.data.unknown).toEqual(["NOPE"]);
    expect(r.data.marketCapsIssue).toBeNull();
  });

  it("fails plainly when there's no price at all for the company", async () => {
    vi.mocked(recentPrices).mockResolvedValue(new Map([["ME", { error: "rate_limited" as const }]]));
    expect(await buildComps(db, "ME", null)).toEqual({ ok: false, error: "rate_limited" });
  });

  it("returns not_found for unknown targets", async () => {
    expect(await buildComps(db, "ZZZZ", null)).toEqual({ ok: false, error: "not_found" });
  });
});
