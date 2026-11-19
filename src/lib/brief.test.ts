import { describe, expect, it } from "vitest";
import { BRIEF_LIMIT, buildBrief, partOfDay, type BriefInput } from "./brief";
import type { SnapshotPayload } from "./snapshotShared";

const filing = (form: string, filed: string) => ({ accn: `${form}-${filed}`, form, filed, reportDate: null, primaryDocument: "d.htm", items: [] });
function snap(o: { recent?: ReturnType<typeof filing>[]; next?: string | null; bought?: number; sold?: number; pending?: number; filingsFail?: boolean }): SnapshotPayload {
  return {
    symbol: "X",
    cik: 7,
    quality: { ok: false, error: "not_found" },
    filings: o.filingsFail
      ? { ok: false, error: "upstream" }
      : { ok: true, data: { report: null, latest: null, recent: o.recent ?? [], nextResults: o.next ? { date: o.next, basedOn: "2025-11-20" } : null } },
    insiders: { ok: true, data: { from: "", to: "", bought: o.bought ?? 0, sold: o.sold ?? 0, buyers: o.bought ? 2 : 0, sellers: 0, pending: o.pending ?? 0, checkedAt: "" } },
  };
}
const row = (symbol: string, snapshot: SnapshotPayload | null, price: number | null = null, fairValue: number | null = null): BriefInput => ({ symbol, snapshot, price, fairValue });

describe("morning briefing", () => {
  const today = "2026-11-19";

  it("collects the week's filings, newest first", () => {
    const b = buildBrief([row("AAPL", snap({ recent: [filing("8-K", "2026-11-14")] })), row("MSFT", snap({ recent: [filing("10-Q", "2026-11-18"), filing("8-K", "2026-11-14")] }))], today);
    expect(b.filings.map((f) => `${f.symbol} ${f.filing.form} ${f.filing.filed}`)).toEqual(["MSFT 10-Q 2026-11-18", "AAPL 8-K 2026-11-14", "MSFT 8-K 2026-11-14"]);
    expect(b.filings[0].cik).toBe(7);
  });

  it("keeps results due in the next two weeks, soonest first", () => {
    const b = buildBrief(
      [row("A", snap({ next: "2026-12-01" })), row("B", snap({ next: "2026-11-20" })), row("C", snap({ next: "2026-12-10" })), row("D", snap({ next: "2026-11-18" }))],
      today,
    );
    expect(b.results.map((r) => r.symbol)).toEqual(["B", "A"]); // C is too far, D already passed
  });

  it("ranks the widest gaps to your fair value, in either direction", () => {
    const b = buildBrief([row("A", null, 100, 110), row("B", null, 100, 70), row("C", null, null, 50), row("D", null, 100, null)], today);
    expect(b.fairValue.map((f) => [f.symbol, +f.gap.toFixed(2)])).toEqual([
      ["B", -0.3],
      ["A", 0.1],
    ]);
  });

  it("lists insider buying only, largest first, and says when the figure is partial", () => {
    const b = buildBrief([row("A", snap({ bought: 2e6, sold: 9e6 })), row("B", snap({ bought: 5e6, pending: 3 })), row("C", snap({ sold: 1e7 }))], today);
    expect(b.insiders.map((i) => [i.symbol, i.partial])).toEqual([
      ["B", true],
      ["A", false],
    ]);
  });

  it("skips what didn't load and caps each list", () => {
    const many = Array.from({ length: BRIEF_LIMIT + 3 }, (_, i) => row(`S${i}`, snap({ recent: [filing("8-K", "2026-11-18")] })));
    const b = buildBrief([...many, row("BAD", snap({ filingsFail: true })), row("NONE", null)], today);
    expect(b.filings).toHaveLength(BRIEF_LIMIT);
    expect(b.filings.some((f) => f.symbol === "BAD" || f.symbol === "NONE")).toBe(false);
  });

  it("greets by time of day", () => {
    expect([partOfDay(7), partOfDay(12), partOfDay(18), partOfDay(22)]).toEqual(["morning", "afternoon", "afternoon", "evening"]);
  });
});
