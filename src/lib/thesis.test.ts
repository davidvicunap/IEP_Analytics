import { describe, expect, it } from "vitest";
import { applyInput, emptyNote, parseInput, type ResearchNote } from "./research";
import { memoryAlerts } from "./thesisAlertStore";
import { checkThesis } from "./thesesData";
import { evaluate, isWatched, type CheckBody, mergeChecks, parseChecks, reconcile, statusOf, thesisReturn, type LiveFields, type Signal, type StoredAlert, type ThesisCheck, type ThesisFacts } from "./thesis";

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
  it("raises the stop, target and fair value in the direction the user expects", () => {
    const up = live({ stop: 200, target: 260, fairValue: 250 });
    expect(kinds(evaluate(up, price(230), TODAY))).toEqual([]);
    expect(kinds(evaluate(up, price(199), TODAY))).toEqual(["stop"]);
    expect(kinds(evaluate(up, price(255), TODAY))).toEqual(["fairValue"]);
    expect(kinds(evaluate(up, price(260), TODAY))).toEqual(["target", "fairValue"]);
    // Expecting a fall: the stop is above, the target and fair value below.
    const down = live({ direction: "down", stop: 260, target: 200, fairValue: 210 });
    expect(kinds(evaluate(down, price(261), TODAY))).toEqual(["stop"]);
    expect(kinds(evaluate(down, price(205), TODAY))).toEqual(["fairValue"]);
    expect(evaluate(down, price(200), TODAY).signals.map((s) => [s.key, s.tone])).toEqual([
      ["target", "good"],
      ["fairValue", "attention"],
    ]);
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
    expect(kinds(r)).toEqual(["reviewBy", "price:p", "move:m", "verdict:g", "report:r:0001", "results:e:2026-11-25"]);
    expect(r.signals.find((s) => s.kind === "verdict")).toMatchObject({ tone: "risk", data: { area: "growth", now: "mid", min: "good" } });
    // A report filed before the check started, results too far off, debt still in line: nothing.
    const older = evaluate(n, { ...facts, report: { accn: "0000", form: "10-K", filed: "2026-10-30" }, nextResults: { date: "2026-12-10" } }, "2026-11-19");
    expect(kinds(older)).toEqual(["price:p", "move:m", "verdict:g"]);
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
    expect(first.alerts.map((a) => a.key)).toEqual(["stop"]);
    const again = await checkThesis("ana", note, alerts, facts, new Date("2026-11-20T16:00:00Z"));
    expect(again.alerts.map((a) => a.firedAt)).toEqual([first.alerts[0].firedAt]);
    p = 210;
    const later = await checkThesis("ana", note, alerts, facts, new Date("2026-11-20T17:00:00Z"));
    expect(later.status).toBe("onTrack");
    expect((await alerts.history("ana", "AAPL", 10)).map((a) => [a.key, a.clearedAt])).toEqual([["stop", "2026-11-20T17:00:00.000Z"]]);
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
