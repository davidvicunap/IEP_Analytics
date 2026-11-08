import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/db/schema";
import type { Db } from "@/db/client";
import { buildInsiders, filingIndexUrl, refreshInsiders } from "./insiders";

const SALE = readFileSync("src/lib/__fixtures__/form4/aapl-sale-10b5-1.xml", "utf8");
const MIXED = readFileSync("src/lib/__fixtures__/form4/aapl-exercise-sale-gift.xml", "utf8");
// A purchase, made from the sale fixture (test only).
const BUY = SALE.replace("<transactionCode>S</transactionCode>", "<transactionCode>P</transactionCode>")
  .replace("<value>D</value>\n                </transactionAcquiredDisposedCode>", "<value>A</value>\n                </transactionAcquiredDisposedCode>")
  .replace("<aff10b5One>true</aff10b5One>", "<aff10b5One>false</aff10b5One>")
  .replace(/<footnote id="F1">[^<]*<\/footnote>/, '<footnote id="F1">Open market purchase.</footnote>');

const submissions = {
  filings: {
    recent: {
      form: ["4", "4", "4/A", "4", "4", "8-K", "4"],
      filingDate: ["2026-11-05", "2026-10-29", "2026-10-28", "2026-10-22", "2026-06-01", "2026-05-01", "2024-01-10"],
      accessionNumber: ["acc-sale", "acc-mixed", "acc-amend", "acc-missing", "acc-buy", "acc-8k", "acc-old"],
      primaryDocument: ["xslF345X06/form4.xml", "xslF345X06/form4.xml", "xslF345X06/form4.xml", "xslF345X06/form4.xml", "xslF345X06/form4.xml", "a.htm", "xslF345X06/form4.xml"],
    },
  },
};

let db: Db;
const fetched: string[] = [];
const fetchJson = async () => submissions;
const docs: Record<string, string | number> = { accsale: SALE, accmixed: MIXED, accbuy: BUY, accmissing: 404 };
const fetchText = async (url: string) => {
  fetched.push(url);
  const key = url.split("/").at(-2)!.replace(/-/g, "");
  const doc = docs[key];
  if (typeof doc === "number") throw Object.assign(new Error(String(doc)), { status: doc });
  if (doc === undefined) throw Object.assign(new Error("unexpected"), { status: 500 });
  return doc;
};

beforeAll(async () => {
  const pg = drizzle(new PGlite(), { schema });
  await migrate(pg, { migrationsFolder: "./drizzle" });
  db = pg as unknown as Db;
});

describe("refreshInsiders", () => {
  it("reads new Form 4s in the window, skips amendments and records missing documents", async () => {
    const r = await refreshInsiders(db, 320193, { today: "2026-11-07", fetchJson, fetchText });
    expect(r).toEqual({ read: 3, failed: 1, pending: 0 });
    expect(fetched.map((u) => u.split("/").at(-2))).toEqual(["accsale", "accmixed", "accmissing", "accbuy"]); // newest first, no 4/A, no 2024
    const filings = await db.select().from(schema.insiderFilings);
    expect(filings.find((f) => f.accn === "acc-missing")?.status).toBe("error");
  });

  it("downloads nothing again on the next check", async () => {
    fetched.length = 0;
    expect(await refreshInsiders(db, 320193, { today: "2026-11-07", fetchJson, fetchText })).toEqual({ read: 0, failed: 0, pending: 0 });
    expect(fetched).toEqual([]);
  });

  it("stops on a rate limit and leaves the rest pending", async () => {
    const other = { filings: { recent: { ...submissions.filings.recent, accessionNumber: submissions.filings.recent.accessionNumber.map((a) => `x-${a}`) } } };
    const limited = async () => {
      throw Object.assign(new Error("429"), { status: 429 });
    };
    const r = await refreshInsiders(db, 999, { today: "2026-11-07", fetchJson: async () => other, fetchText: limited });
    expect(r).toEqual({ read: 0, failed: 0, pending: 4 });
  });
});

describe("buildInsiders", () => {
  it("summarizes 12 months and lists purchases and sales with links to EDGAR", async () => {
    const r = await buildInsiders(db, "AAPL", 320193, { today: "2026-11-07", fetchJson, fetchText });
    if (!r.ok) throw new Error(r.error);
    const { summary, recent, pending } = r.data;
    expect(pending).toBe(0);
    expect(summary.purchases).toMatchObject({ count: 1, insiders: 1, shares: 2399 });
    expect(summary.plannedSales.count).toBe(5); // 1 + 4 sales, all under 10b5-1 plans
    expect(summary.sales.count).toBe(0);
    expect(summary.otherCount).toBe(3); // exercise, withholding, gift
    expect(recent[0]).toMatchObject({ accn: "acc-sale", code: "S", url: filingIndexUrl(320193, "acc-sale") });
    expect(recent.every((t) => t.code === "S" || t.code === "P")).toBe(true);
  });

  it("reports an error when the issuer has never been read and the SEC fails", async () => {
    const down = async () => {
      throw Object.assign(new Error("503"), { status: 503 });
    };
    expect(await buildInsiders(db, "NEW", 4242, { today: "2026-11-07", fetchJson: down, fetchText })).toEqual({ ok: false, error: "upstream" });
  });
});
