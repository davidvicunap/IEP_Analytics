import { describe, expect, it } from "vitest";
import type { Filing } from "./filingsShared";
import { createLimiter } from "./snapshotClient";
import { pickFilings, settled, type SnapshotPayload } from "./snapshotShared";

const f = (form: string, filed: string, items: string[] = []): Filing => ({ accn: `${form}-${filed}`, form, filed, reportDate: null, primaryDocument: "d.htm", description: "", items, inlineXbrl: false });

describe("watchlist snapshot", () => {
  it("picks the newest periodic report and the newest filing about the business", () => {
    const filings = [f("4", "2026-11-09"), f("SC 13G/A", "2026-11-08"), f("8-K", "2026-11-05", ["2.02", "9.01"]), f("10-K/A", "2026-11-04"), f("10-Q", "2026-10-30"), f("10-K", "2026-02-01")];
    const { report, latest } = pickFilings(filings);
    expect(report).toMatchObject({ form: "10-Q", filed: "2026-10-30" }); // amendment skipped
    expect(latest).toMatchObject({ form: "8-K", filed: "2026-11-05", items: ["2.02", "9.01"] }); // insider and ownership forms skipped
    expect(pickFilings([f("4", "2026-01-01")])).toEqual({ report: null, latest: null });
  });

  it("is only cacheable once every part answered and no insider filings are left to read", () => {
    const base: SnapshotPayload = {
      symbol: "X",
      cik: 1,
      quality: { ok: true, data: { passed: 1, failed: 0, na: 0, level: "high", fiscal: null } },
      filings: { ok: true, data: { report: null, latest: null } },
      insiders: { ok: true, data: { from: "", to: "", bought: 0, sold: 0, buyers: 0, sellers: 0, pending: 0, checkedAt: "" } },
    };
    expect(settled(base)).toBe(true);
    expect(settled({ ...base, quality: { ok: false, error: "upstream" } })).toBe(false);
    expect(settled({ ...base, insiders: { ok: true, data: { from: "", to: "", bought: 0, sold: 0, buyers: 0, sellers: 0, pending: 3, checkedAt: "" } } })).toBe(false);
  });
});

describe("request limiter", () => {
  it("runs at most n tasks at once, in order", async () => {
    const run = createLimiter(2);
    let active = 0;
    let peak = 0;
    const started: number[] = [];
    const task = (i: number) => async () => {
      started.push(i);
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return i;
    };
    const results = await Promise.all([1, 2, 3, 4, 5].map((i) => run(task(i))));
    expect(results).toEqual([1, 2, 3, 4, 5]);
    expect(started).toEqual([1, 2, 3, 4, 5]);
    expect(peak).toBe(2);
  });

  it("keeps going after a task fails", async () => {
    const run = createLimiter(1);
    const a = run(() => Promise.reject(new Error("x")));
    const b = run(() => Promise.resolve(2));
    await expect(a).rejects.toThrow("x");
    await expect(b).resolves.toBe(2);
  });
});
