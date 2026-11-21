import { describe, expect, it } from "vitest";
import { applyInput, emptyNote, parseInput, type ResearchNote } from "./research";
import { memoryAlerts } from "./thesisAlertStore";
import { checkThesis, rotatingBatch } from "./thesesData";
import { evaluate, fairValueSide, isWatched, previewPlan, type CheckBody, mergeChecks, parseChecks, reconcile, statusOf, thesisReturn, type LiveFields, type Signal, type StoredAlert, type ThesisCheck, type ThesisFacts } from "./thesis";

const TODAY = "2026-11-20";
const live = (over: Partial<LiveFields> = {}): LiveFields => ({
  direction: "up",
  fairValue: null,
  stop: null,
  target: null,
  reviewBy: null,
  checks: [],
  closed: null,
  updatedAt: "2026-11-01T10:00:00.000Z",
  ...over,
});
const check = (body: CheckBody, id = "c1", createdAt = "2026-11-01T10:00:00.000Z") => ({ ...body, id, createdAt }) as ThesisCheck;
const price = (value: number, changePct: number | null = 0): ThesisFacts => ({ price: { value, changePct, at: "2026-11-20T21:00:00.000Z" } });
const kinds = (r: { signals: Signal[] }) => r.signals.map((s) => s.key);

describe("what a thesis watches", () => {
  it("watches an open, saved note with a level, a review date or a check", () => {
    expect(isWatched(live())).toBe(false);
    expect(isWatched(live({ stop: 200 }))).toBe(true);
    expect(isWatched(live({ reviewBy: "2027-01-01" }))).toBe(true);
    expect(isWatched(live({ stop: 200, updatedAt: null }))).toBe(false);
    expect(isWatched(live({ stop: 200, closed: { at: TODAY, price: 1, outcome: "right", lesson: "" } }))).toBe(false);
  });

  it("accepts only well-formed checks, at most eight", () => {
    expect(parseChecks([{ type: "price", op: "below", value: 199.123456 }, { type: "move", pct: 5 }, { type: "verdict", area: "growth", min: "good" }, { type: "report" }, { type: "results", days: 7 }])).toEqual([
      { type: "price", op: "below", value: 199.1235, id: undefined },
      { type: "move", pct: 5, id: undefined },
      { type: "verdict", area: "growth", min: "good", id: undefined },
      { type: "report", id: undefined },
      { type: "results", days: 7, id: undefined },
    ]);
    for (const bad of [[{ type: "price", op: "near", value: 1 }], [{ type: "price", op: "below", value: -1 }], [{ type: "move", pct: 0 }], [{ type: "verdict", area: "moat", min: "good" }], [{ type: "results", days: 5 }], [{ type: "magic" }], Array(9).fill({ type: "report" }), "x"]) {
      expect(parseChecks(bad)).toBeNull();
    }
  });

  it("keeps a check's start date while it exists and starts new ones now", () => {
    const prev = [check({ type: "report" }, "a", "2026-10-01T00:00:00.000Z")];
    let n = 0;
    const merged = mergeChecks(prev, [{ id: "a", type: "report" }, { type: "move", pct: 4 }], "2026-11-20T00:00:00.000Z", () => `new${++n}`);
    expect(merged).toEqual([
      { type: "report", id: "a", createdAt: "2026-10-01T00:00:00.000Z" },
      { type: "move", pct: 4, id: "new1", createdAt: "2026-11-20T00:00:00.000Z" },
    ]);
  });
});

describe("evaluating a thesis", () => {
  it("raises the stop and target in the direction the user expects", () => {
    const up = live({ stop: 200, target: 260 });
    expect(kinds(evaluate(up, price(230), TODAY))).toEqual([]);
    expect(kinds(evaluate(up, price(199), TODAY))).toEqual(["stop:200"]);
    expect(kinds(evaluate(up, price(260), TODAY))).toEqual(["target:260"]);
    // Expecting a fall: the stop is above, the target below.
    const down = live({ direction: "down", stop: 260, target: 200 });
    expect(kinds(evaluate(down, price(261), TODAY))).toEqual(["stop:260"]);
    expect(evaluate(down, price(200), TODAY).signals.map((s) => [s.key, s.tone])).toEqual([["target:200", "good"]]);
    // A new level is a new alert (its key changes), so an edited stop never shows the old figure.
    expect(kinds(evaluate({ ...up, stop: 198 }, price(197), TODAY))).toEqual(["stop:198"]);
  });

  it("raises the fair value only when the price crosses it from where it was when it was set", () => {
    const setAt = (fairValue: number, at: number | null) => live({ fairValue, log: [{ kind: "fairValue", value: fairValue, price: at }] });
    // Set below the price (MSFT: $400 while at $523.88): nothing until the price falls to it.
    const below = setAt(400, 523.88);
    expect(kinds(evaluate(below, price(523.88), TODAY))).toEqual([]);
    expect(evaluate(below, price(399), TODAY).signals).toEqual([{ key: "fairValue:400", kind: "fairValue", tone: "attention", data: { price: 399, level: 400, op: "below" } }]);
    // Set above the price: the alert is the price rising to it, whatever the direction.
    const above = { ...setAt(250, 230), direction: "down" as const };
    expect(kinds(evaluate(above, price(240), TODAY))).toEqual([]);
    expect(evaluate(above, price(251), TODAY).signals[0].data).toEqual({ price: 251, level: 250, op: "above" });
    // Unknown price when it was set: no guess.
    expect(kinds(evaluate(setAt(250, null), price(300), TODAY))).toEqual([]);
    expect(kinds(evaluate(live({ fairValue: 250 }), price(300), TODAY))).toEqual([]);
  });

  it("says what it couldn't check instead of guessing", () => {
    const n = live({ stop: 200, checks: [check({ type: "verdict", area: "debt", min: "mid" }, "v"), check({ type: "report" }, "r")] });
    const r = evaluate(n, { price: null, verdict: null, report: null, nextResults: null }, TODAY);
    expect(r.signals).toEqual([]);
    expect(r.unchecked.sort()).toEqual(["fairValue", "move", "price", "report", "stop", "target", "verdict"]);
  });

  it("checks custom prices, daily moves, verdict lines, reports, results and the review date", () => {
    const n = live({
      reviewBy: "2026-11-20",
      checks: [
        check({ type: "price", op: "above", value: 240 }, "p"),
        check({ type: "move", pct: 5 }, "m"),
        check({ type: "verdict", area: "growth", min: "good" }, "g"),
        check({ type: "verdict", area: "debt", min: "mid" }, "d"),
        check({ type: "report" }, "r", "2026-11-01T09:00:00.000Z"),
        check({ type: "results", days: 7 }, "e"),
      ],
    });
    const facts: ThesisFacts = {
      price: { value: 241, changePct: -5.5, at: "x" },
      verdict: { growth: "mid", debt: "mid" },
      report: { accn: "0001", form: "10-Q", filed: "2026-11-01" },
      nextResults: { date: "2026-11-25" },
    };
    const r = evaluate(n, facts, TODAY);
    expect(kinds(r)).toEqual(["reviewBy:2026-11-20", "price:p:above:240", "move:m:5", "verdict:g:good", "report:r:0001", "results:e:2026-11-25"]);
    expect(r.signals.find((s) => s.kind === "verdict")).toMatchObject({ tone: "risk", data: { area: "growth", now: "mid", min: "good" } });
    // A report filed before the check started, results too far off, debt still in line: nothing.
    const older = evaluate(n, { ...facts, report: { accn: "0000", form: "10-K", filed: "2026-10-30" }, nextResults: { date: "2026-12-10" } }, "2026-11-19");
    expect(kinds(older)).toEqual(["price:p:above:240", "move:m:5", "verdict:g:good"]);
    // A verdict without the checked line today (no data) is unknown, not recovered.
    const gap = evaluate(n, { ...facts, verdict: { debt: "mid" } }, TODAY);
    expect(gap.unchecked).toContain("verdict");
  });

  it("never alerts on a closed thesis", () => {
    expect(evaluate(live({ stop: 300, closed: { at: TODAY, price: 1, outcome: "wrong", lesson: "" } }), price(100), TODAY).signals).toEqual([]);
  });
});

describe("alerts", () => {
  const now = new Date("2026-11-20T21:00:00Z");
  const sig = (key: string, kind: Signal["kind"] = "stop", tone: Signal["tone"] = "risk"): Signal => ({ key, kind, tone, data: {} });
  const stored = (key: string, firedAt: string, clearedAt: string | null, kind: Signal["kind"] = "stop"): StoredAlert => ({ key, kind, tone: "risk", data: {}, firedAt, clearedAt });

  it("fires once, clears when no longer true and doesn't repeat within a day", () => {
    expect(reconcile([], [sig("stop")], [], now)).toEqual({ fire: [sig("stop")], clear: [], revive: [] });
    expect(reconcile([stored("stop", "2026-11-19T10:00:00Z", null)], [sig("stop")], [], now)).toEqual({ fire: [], clear: [], revive: [] });
    expect(reconcile([stored("stop", "2026-11-19T10:00:00Z", null)], [], [], now)).toEqual({ fire: [], clear: ["stop"], revive: [] });
    // Cleared two hours ago, true again: the same alert is active again, not a new firing.
    expect(reconcile([stored("stop", "2026-11-20T15:00:00Z", "2026-11-20T19:00:00Z")], [sig("stop")], [], now)).toEqual({ fire: [], clear: [], revive: ["stop"] });
    // A day after it fired, it's a new alert.
    expect(reconcile([stored("stop", "2026-11-19T15:00:00Z", "2026-11-19T19:00:00Z")], [sig("stop")], [], now).fire).toEqual([sig("stop")]);
  });

  it("keeps an alert whose data was unavailable this time", () => {
    expect(reconcile([stored("stop", "2026-11-19T10:00:00Z", null)], [], ["stop"], now)).toEqual({ fire: [], clear: [], revive: [] });
  });

  it("sums a thesis up in one word", () => {
    const n = live({ stop: 1 });
    expect(statusOf(live(), [])).toBe("idle");
    expect(statusOf(n, [])).toBe("onTrack");
    expect(statusOf(n, [{ tone: "good" }])).toBe("review");
    expect(statusOf(n, [{ tone: "attention" }, { tone: "risk" }])).toBe("atRisk");
    expect(statusOf({ ...n, closed: { at: TODAY, price: 1, outcome: "right", lesson: "" } }, [{ tone: "risk" }])).toBe("closed");
  });

  it("measures a closed thesis in the direction expected", () => {
    expect(thesisReturn("up", 100, 120)).toBeCloseTo(0.2);
    expect(thesisReturn("down", 100, 120)).toBeCloseTo(-0.2);
    expect(thesisReturn("up", null, 120)).toBeNull();
  });
});

describe("the thesis lifecycle in the notebook", () => {
  let n = 0;
  const id = () => `id${++n}`;
  const t = (h: string) => new Date(`2026-11-20T${h}:00Z`);

  it("records when it starts being watched, closes with its outcome and reopens", () => {
    const parsed = parseInput({ stop: 200, direction: "up", reviewBy: "2027-02-01", checks: [{ type: "report" }] });
    expect(parsed.ok).toBe(true);
    const a = applyInput(null, "AAPL", { ...(parsed as { ok: true; input: Parameters<typeof applyInput>[2] }).input, price: 230 }, t("10:00"), id);
    expect(a.opened).toEqual({ at: "2026-11-20T10:00:00.000Z", price: 230 });
    expect(a.checks).toEqual([{ type: "report", id: expect.any(String), createdAt: "2026-11-20T10:00:00.000Z" }]);
    const b = applyInput(a, "AAPL", { close: { outcome: "right", lesson: "Patience paid" }, price: 250, baseUpdatedAt: "stale is fine" }, t("11:00"), id);
    expect(b.closed).toEqual({ at: "2026-11-20T11:00:00.000Z", price: 250, outcome: "right", lesson: "Patience paid" });
    expect(isWatched(b)).toBe(false);
    const c = applyInput(b, "AAPL", { reopen: true, price: 240, baseUpdatedAt: null }, t("12:00"), id);
    expect(c.closed).toBeNull();
    expect(c.opened).toEqual({ at: "2026-11-20T12:00:00.000Z", price: 240 });
    expect(c.log.filter((e) => e.kind === "status").map((e) => (e.kind === "status" ? e.to : ""))).toEqual(["reopened", "closed", "opened"]);
  });

  it("rejects malformed thesis edits", () => {
    for (const bad of [{ direction: "sideways" }, { reviewBy: "soon" }, { checks: [{ type: "x" }] }, { close: { outcome: "great" } }, { close: { outcome: "right", lesson: 5 } }, { reopen: "yes" }]) {
      expect(parseInput(bad)).toEqual({ ok: false, error: "invalid" });
    }
  });
});

describe("checking a thesis with stored alerts", () => {
  it("records an alert once and clears it when the price recovers", async () => {
    const alerts = memoryAlerts();
    const note: ResearchNote = { ...emptyNote("AAPL"), stop: 200, updatedAt: "2026-11-01T00:00:00.000Z" };
    let p = 190;
    const facts = async (): Promise<ThesisFacts> => price(p);
    const first = await checkThesis("ana", note, alerts, facts, new Date("2026-11-20T15:00:00Z"));
    expect(first.status).toBe("atRisk");
    expect(first.alerts.map((a) => a.key)).toEqual(["stop:200"]);
    const again = await checkThesis("ana", note, alerts, facts, new Date("2026-11-20T16:00:00Z"));
    expect(again.alerts.map((a) => a.firedAt)).toEqual([first.alerts[0].firedAt]);
    p = 210;
    const later = await checkThesis("ana", note, alerts, facts, new Date("2026-11-20T17:00:00Z"));
    expect(later.status).toBe("onTrack");
    expect((await alerts.history("ana", "AAPL", 10)).map((a) => [a.key, a.clearedAt])).toEqual([["stop:200", "2026-11-20T17:00:00.000Z"]]);
    // Hit again the same day: at risk again, with the same alert (no second firing).
    p = 195;
    const back = await checkThesis("ana", note, alerts, facts, new Date("2026-11-20T18:00:00Z"));
    expect(back.status).toBe("atRisk");
    expect((await alerts.history("ana", "AAPL", 10)).map((a) => [a.firedAt, a.clearedAt])).toEqual([[first.alerts[0].firedAt, null]]);
    await alerts.remove("ana", "AAPL");
    expect(await alerts.history("ana", "AAPL", 10)).toEqual([]);
    expect(await alerts.history("bob", "AAPL", 10)).toEqual([]);
  });
});

describe("plan preview", () => {
  it("says what each level will do, from the price now", () => {
    // The MSFT case: fair value $400 at a price of $523.88 alerts only on a fall to $400.
    expect(previewPlan({ direction: "up", fairValue: 400, stop: 480, target: 600 }, 523.88)).toEqual([
      { kind: "fairValue", level: 400, pct: 400 / 523.88 - 1, trigger: "falls" },
      { kind: "stop", level: 480, pct: 480 / 523.88 - 1, trigger: "falls" },
      { kind: "target", level: 600, pct: 600 / 523.88 - 1, trigger: "rises" },
    ]);
  });

  it("flags a stop or target already on the wrong side of the price", () => {
    expect(previewPlan({ direction: "up", fairValue: null, stop: 550, target: 500 }, 523.88).map((i) => [i.kind, i.trigger])).toEqual([
      ["stop", "now"],
      ["target", "now"],
    ]);
    expect(previewPlan({ direction: "down", fairValue: null, stop: 550, target: 500 }, 523.88).map((i) => [i.kind, i.trigger])).toEqual([
      ["stop", "rises"],
      ["target", "falls"],
    ]);
    expect(previewPlan({ direction: "up", fairValue: 400, stop: null, target: null }, null)).toEqual([]);
  });
});

describe("marking an alert as seen", () => {
  it("keeps it active on the thesis, marked seen; a new firing later is unseen", async () => {
    const alerts = memoryAlerts();
    const note: ResearchNote = { ...emptyNote("KO"), stop: 60, updatedAt: "2026-11-01T00:00:00.000Z" };
    let p = 55;
    const facts = async (): Promise<ThesisFacts> => price(p);
    await checkThesis("ana", note, alerts, facts, new Date("2026-11-20T15:00:00Z"));
    expect(await alerts.dismiss("ana", "KO", "stop:60", new Date("2026-11-20T16:00:00Z"))).toBe(true);
    expect(await alerts.dismiss("ana", "KO", "target", new Date("2026-11-20T16:00:00Z"))).toBe(false);
    const view = await checkThesis("ana", note, alerts, facts, new Date("2026-11-20T17:00:00Z"));
    expect(view.status).toBe("atRisk"); // seen, but still true
    expect(view.alerts.map((a) => a.dismissedAt)).toEqual(["2026-11-20T16:00:00.000Z"]);
    // Recovers, then hits the stop again two days later: a new, unseen alert.
    p = 65;
    await checkThesis("ana", note, alerts, facts, new Date("2026-11-21T15:00:00Z"));
    p = 55;
    const again = await checkThesis("ana", note, alerts, facts, new Date("2026-11-23T15:00:00Z"));
    expect(again.alerts.map((a) => a.dismissedAt ?? null)).toEqual([null]);
  });
});

describe("the notebook log", () => {
  it("keeps the entry behind the current fair value under many newer notes", () => {
    let n = 0;
    const id = () => `n${++n}`;
    let note = applyInput(null, "KO", { fairValue: 80, price: 60, baseUpdatedAt: null }, new Date("2026-11-01T00:00:00Z"), id);
    for (let i = 0; i < 250; i++) note = applyInput(note, "KO", { addNote: `note ${i}`, baseUpdatedAt: note.updatedAt }, new Date(Date.parse("2026-11-02T00:00:00Z") + i * 60_000), id);
    expect(note.log.length).toBeLessThanOrEqual(200);
    expect(fairValueSide(note)).toBe("below");
  });
});

describe("checking many theses", () => {
  it("takes turns: each hour a different batch, every thesis covered within a few hours", () => {
    const all = Array.from({ length: 95 }, (_, i) => `S${i}`);
    const seen = new Set<string>();
    for (let h = 0; h < 3; h++) for (const s of rotatingBatch(all, 40, new Date(Date.UTC(2026, 10, 20, h)))) seen.add(s);
    expect(seen.size).toBe(95);
    expect(rotatingBatch(all.slice(0, 10), 40, new Date())).toHaveLength(10);
  });
});
