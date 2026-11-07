import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/db/schema";
import type { Db } from "@/db/client";
import { escapeLike, refreshSecurities, searchSecurities, securitiesStatus } from "./securities";
import { parseCompanyTickers } from "./sec";

const SEC_SAMPLE = {
  fields: ["cik", "name", "ticker", "exchange"],
  data: [
    [320193, "Apple Inc.", "AAPL", "Nasdaq"],
    [1418121, "Apple Hospitality REIT, Inc.", "APLE", "NYSE"],
    [789019, "MICROSOFT CORP", "MSFT", "Nasdaq"],
    [1067983, "BERKSHIRE HATHAWAY INC", "BRK-B", "NYSE"],
    [9999999, "Some OTC Co", "OTCX", "OTC"],
    [8888888, "No Exchange Co", "NOEX", null],
    [320193, "Apple Inc.", "AAPL", "Nasdaq"],
    ["bad", "Broken row", "BAD", "NYSE"],
  ],
};

let db: Db;

beforeAll(async () => {
  const client = new PGlite();
  const pg = drizzle(client, { schema });
  await migrate(pg, { migrationsFolder: "./drizzle" });
  db = pg as unknown as Db;
});

describe("parseCompanyTickers", () => {
  it("keeps exchange-listed tickers once and drops OTC, missing exchanges and bad rows", () => {
    const rows = parseCompanyTickers(SEC_SAMPLE);
    expect(rows.map((r) => r.symbol)).toEqual(["AAPL", "APLE", "MSFT", "BRK-B"]);
    expect(rows[0]).toMatchObject({ cik: 320193, exchange: "NASDAQ" });
  });

  it("rejects an unexpected payload instead of wiping data", () => {
    expect(() => parseCompanyTickers({ data: [] })).toThrow();
    expect(() => parseCompanyTickers(null)).toThrow();
  });
});

describe("securities table (real migration on PGlite)", () => {
  it("loads the SEC list and reports its status", async () => {
    const result = await refreshSecurities(db, parseCompanyTickers(SEC_SAMPLE));
    expect(result).toEqual({ upserted: 4, deactivated: 0 });
    const status = await securitiesStatus(db);
    expect(status.active).toBe(4);
    expect(status.updatedAt).toBeInstanceOf(Date);
  });

  it("ranks exact symbol, then symbol prefix, then name matches", async () => {
    expect((await searchSecurities(db, "aapl")).map((r) => r.symbol)).toEqual(["AAPL"]);
    // "ap" is a symbol prefix of APLE and appears in the name "Apple Inc." (AAPL).
    expect((await searchSecurities(db, "ap")).map((r) => r.symbol)).toEqual(["APLE", "AAPL"]);
    expect((await searchSecurities(db, "apple")).map((r) => r.symbol)).toEqual(["AAPL", "APLE"]);
    expect((await searchSecurities(db, "microsoft"))[0]).toMatchObject({ symbol: "MSFT", exchange: "NASDAQ" });
    expect((await searchSecurities(db, "brk-b"))[0].symbol).toBe("BRK-B");
  });

  it("treats LIKE wildcards in the query literally", async () => {
    expect(escapeLike("50%_off\\")).toBe("50\\%\\_off\\\\");
    expect(await searchSecurities(db, "%")).toEqual([]);
    expect(await searchSecurities(db, "_")).toEqual([]);
  });

  it("deactivates symbols that disappear from the SEC list and hides them from search", async () => {
    await new Promise((r) => setTimeout(r, 5));
    const withoutMsft = { ...SEC_SAMPLE, data: SEC_SAMPLE.data.filter((row) => row[2] !== "MSFT") };
    const result = await refreshSecurities(db, parseCompanyTickers(withoutMsft));
    expect(result).toEqual({ upserted: 3, deactivated: 1 });
    expect(await searchSecurities(db, "microsoft")).toEqual([]);
    expect((await securitiesStatus(db)).active).toBe(3);
  });

  it("refuses to refresh from an empty list", async () => {
    await expect(refreshSecurities(db, [])).rejects.toThrow();
  });
});
