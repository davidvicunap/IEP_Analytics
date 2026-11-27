import { describe, expect, it } from "vitest";
import type { Filing } from "./filingsShared";
import { createLimiter } from "./snapshotClient";
import { pickFilings, settled, type SnapshotPayload } from "./snapshotShared";

const f = (form: string, filed: string, items: string[] = []): Filing => ({ accn: `${form}-${filed}`, form, filed, reportDate: null, primaryDocument: "d.htm", description: "", items, inlineXbrl: false });

describe("hub row summary", () => {
  it("picks the newest periodic report, skipping amendments", () => {
    const filings = [f("4", "2026-11-09"), f("SC 13G/A", "2026-11-08"), f("8-K", "2026-11-05", ["2.02", "9.01"]), f("10-K/A", "2026-11-04"), f("10-Q", "2026-10-30"), f("10-K", "2026-02-01")];
    expect(pickFilings(filings).report).toMatchObject({ form: "10-Q", filed: "2026-10-30" });
    expect(pickFilings([f("4", "2026-01-01")])).toMatchObject({ report: null, recent: [] });
  });

  it("lists the last week's filings about the business and estimates the next results", () => {
    const filings = [
      f("8-K", "2026-11-18", ["7.01"]),
      f("4", "2026-11-17"),
      f("10-Q", "2026-11-12"),
      f("8-K", "2026-11-05", ["2.02"]), // more than a week ago
      f("8-K", "2026-02-04", ["2.02"]), // last year's results for the coming quarter
    ];
    const r = pickFilings(filings, "2026-11-19");
    expect(r.recent.map((x) => x.form)).toEqual(["8-K", "10-Q"]);
    expect(r.nextResults).toEqual({ date: "2027-02-03", basedOn: "2026-02-04" });
    expect(pickFilings([f("10-Q", "2026-11-12")], "2026-11-19").nextResults).toBeNull();
  });

  it("is cacheable once the filings answered", () => {
    const base: SnapshotPayload = { symbol: "X", cik: 1, filings: { ok: true, data: { report: null, recent: [], nextResults: null } } };
    expect(settled(base)).toBe(true);
    expect(settled({ ...base, filings: { ok: false, error: "upstream" } })).toBe(false);
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
