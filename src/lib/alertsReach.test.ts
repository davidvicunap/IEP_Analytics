import { describe, expect, it } from "vitest";
import es from "./i18n/es";
import { holdingSignals } from "./holdingAlerts";
import { uncheckedMessage } from "./push";
import { applyInput, emptyNote } from "./research";
import { memoryStore } from "./researchStore";
import { memoryAlerts } from "./thesisAlertStore";
import { checkHoldings, checkThesis } from "./thesesData";
import type { ThesisFacts } from "./thesis";

describe("alerts for what you own", () => {
  const facts = (over: Partial<ThesisFacts> = {}): ThesisFacts => ({ nextResults: { date: "2026-11-24" }, report: { accn: "a1", form: "10-Q", filed: "2026-11-20" }, ...over });
  it("results today or tomorrow and a report from the last two days; nothing the thesis already watches", () => {
    expect(holdingSignals(facts({ nextResults: { date: "2026-11-22" } }), "2026-11-21").signals.map((s) => s.key)).toEqual(["holding:results:2026-11-22", "holding:report:a1"]);
    expect(holdingSignals(facts(), "2026-11-21").signals.map((s) => s.key)).toEqual(["holding:report:a1"]); // results in 3 days: not yet
    expect(holdingSignals(facts({ nextResults: { date: "2026-11-21" } }), "2026-11-21", { results: true, report: true }).signals).toEqual([]);
    expect(holdingSignals({ nextResults: null, report: null }, "2026-11-21").unchecked).toEqual(["results", "report"]);
  });

  it("a holding check and a thesis check never clear each other's alerts", async () => {
    const alerts = memoryAlerts();
    const now = new Date("2026-11-21T15:00:00Z");
    const note = applyInput(emptyNote("KO"), "KO", { stop: 50, baseUpdatedAt: null }, new Date("2026-11-01T10:00:00Z"), () => "id");
    const f = async (_s: string, n: { price: boolean; filings: boolean }): Promise<ThesisFacts> => ({ ...(n.price ? { price: { value: 60, changePct: 0, at: now.toISOString() } } : {}), ...(n.filings ? facts({ nextResults: { date: "2026-11-21" } }) : {}) });
    await checkHoldings("ana", ["KO"], new Map([["KO", note]]), alerts, f, now);
    await checkThesis("ana", note, alerts, f, new Date(now.getTime() + 60_000));
    const active = (await alerts.recent("ana", "KO", new Date(0))).filter((a) => a.clearedAt === null).map((a) => a.key);
    expect(active.sort()).toEqual(["holding:report:a1", "holding:results:2026-11-21"]);
  });

  it("after the close, what couldn't be checked is said in one message", () => {
    const [m] = uncheckedMessage([{ symbol: "AAPL", kinds: ["stop", "price"] }, { symbol: "MSFT", kinds: ["report", "results"] }], es);
    expect(m.title).toBe(es.push.msgUncheckedTitle);
    expect(m.body).toContain("AAPL: stop, precio · MSFT: informes, resultados");
    expect(uncheckedMessage([], es)).toEqual([]);
  });
});

describe("a split under a watched thesis", () => {
  it("restates the levels before checking: no false 'hit your stop', and the user is told", async () => {
    const notes = memoryStore();
    const saved = await notes.save("ana", "NVDA", { stop: 900, target: 1500, price: 1000, baseUpdatedAt: null }, new Date("2026-01-05T15:00:00Z"));
    expect(saved.ok).toBe(true);
    const note = (await notes.get("ana", "NVDA"))!;
    const alerts = memoryAlerts();
    const now = new Date("2026-11-21T15:00:00Z");
    const f = async (): Promise<ThesisFacts> => ({ price: { value: 101, changePct: 1, at: now.toISOString() } });
    const view = await checkThesis("ana", note, alerts, f, now, { splits: [{ symbol: "NVDA", ratio: 10, date: "2026-11-20" }], notes });
    expect(view.alerts.map((a) => a.kind)).toEqual(["split"]);
    expect(view.alerts[0].data).toMatchObject({ ratio: 10, adjusted: true });
    expect(await notes.get("ana", "NVDA")).toMatchObject({ stop: 90, target: 150 });
    // Next run: nothing more to adjust, no new alert.
    const again = await checkThesis("ana", (await notes.get("ana", "NVDA"))!, alerts, f, new Date(now.getTime() + 3_600_000), { splits: [{ symbol: "NVDA", ratio: 10, date: "2026-11-20" }], notes });
    expect(again.alerts.map((a) => a.kind)).toEqual(["split"]);
    expect((await alerts.history("ana", "NVDA", 10)).length).toBe(1);
  });

  it("a renamed or delisted ticker raises its own alert", async () => {
    const note = applyInput(emptyNote("FB"), "FB", { reviewBy: "2027-01-01", baseUpdatedAt: null }, new Date("2026-11-01T10:00:00Z"), () => "id");
    const view = await checkThesis("ana", note, memoryAlerts(), async () => ({}), new Date("2026-11-21T15:00:00Z"), { listing: { status: "renamed", to: "META" } });
    expect(view.alerts).toMatchObject([{ kind: "listing", data: { to: "META" } }]);
    expect(view.status).toBe("atRisk");
  });
});
