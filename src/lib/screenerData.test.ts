import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import type { Db } from "@/db/client";
import { refreshSecurities } from "./securities";
import { loadUniverse } from "./screenerData";

describe("screener universe (real migration on PGlite)", () => {
  it("has one row per company for the latest year, its largest share class first", async () => {
    const pg = drizzle(new PGlite(), { schema });
    await migrate(pg, { migrationsFolder: "./drizzle" });
    const db = pg as unknown as Db;
    expect(await loadUniverse(db)).toBeNull(); // no SEC figures yet

    await refreshSecurities(db, [
      { symbol: "GOOGL", cik: 1652044, name: "Alphabet Inc.", exchange: "NASDAQ", rank: 3 },
      { symbol: "GOOG", cik: 1652044, name: "Alphabet Inc.", exchange: "NASDAQ", rank: 4 },
      { symbol: "KO", cik: 21344, name: "COCA COLA CO", exchange: "NYSE", rank: 40 },
    ]);
    await db.update(schema.securities).set({ sic: 7370, sicDescription: "SERVICES-COMPUTER PROGRAMMING" }).where(eq(schema.securities.cik, 1652044));
    const at = new Date("2026-11-01T00:00:00Z");
    await db.insert(schema.companyMetrics).values([
      { cik: 1652044, year: 2025, inputs: { revenue: 400, revenuePrev: 350, operatingIncome: 130 }, updatedAt: at },
      { cik: 21344, year: 2025, inputs: { revenue: 47, grossProfit: 29 }, updatedAt: at },
      { cik: 21344, year: 2024, inputs: { revenue: 45 }, updatedAt: at },
    ]);

    const u = (await loadUniverse(db))!;
    expect(u.year).toBe(2025);
    expect(u.rows.map((r) => r.symbol)).toEqual(["GOOGL", "KO"]);
    expect(u.rows[0]).toMatchObject({ industry: "SERVICES-COMPUTER PROGRAMMING", revenue: 400 });
    expect(u.rows[0].ratios.revenueGrowth).toBeCloseTo(400 / 350 - 1);
    expect(u.rows[1].ratios.grossMargin).toBeCloseTo(29 / 47);
  });
});
