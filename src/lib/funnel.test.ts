import { describe, expect, it } from "vitest";
import { cleanProps, funnel, isEventName, type EventRow } from "./funnel";

const now = new Date("2026-11-21T12:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();

describe("what is recorded", () => {
  it("only known event names and small, non-identifying properties", () => {
    expect(isEventName("visit")).toBe(true);
    expect(isEventName("bought_AAPL")).toBe(false);
    expect(cleanProps({ channel: "telegram", n: 3, ok: true, symbol: "AAPL", note: "free text here", "bad key": 1 })).toEqual({ channel: "telegram", n: 3, ok: true });
    expect(cleanProps([1, 2])).toEqual({});
  });
});

describe("the funnel", () => {
  it("counts people per step, the active ones and who came back in their second week", () => {
    const rows: EventRow[] = [
      // ana: did everything, came back on day 9
      { owner: "ana", name: "visit", at: daysAgo(20) },
      { owner: "ana", name: "position_added", at: daysAgo(20) },
      { owner: "ana", name: "plan_saved", at: daysAgo(20) },
      { owner: "ana", name: "alerts_telegram_on", at: daysAgo(20) },
      { owner: "ana", name: "alert_sent", at: daysAgo(12) },
      { owner: "ana", name: "visit", at: daysAgo(11) },
      { owner: "ana", name: "alert_opened", at: daysAgo(2) },
      // luis: imported, never came back
      { owner: "luis", name: "visit", at: daysAgo(40) },
      { owner: "luis", name: "import_done", at: daysAgo(40) },
      // eva: new this week
      { owner: "eva", name: "visit", at: daysAgo(1) },
    ];
    expect(funnel(rows, now)).toEqual({
      people: 3,
      active7: 2,
      active30: 2,
      steps: { visit: 3, position: 2, exit: 1, alertsOn: 1, alertSent: 1, alertOpened: 1 },
      week2: { eligible: 2, returned: 1 },
    });
  });
});
