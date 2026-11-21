import { describe, expect, it } from "vitest";
import { MAX_SCREENS, PREF_KEYS, isEmptyPref, isPrefKey, mergePref, normalizePref, parseScreens, planSync } from "./prefs";

describe("account settings", () => {
  it("knows its keys", () => {
    expect(PREF_KEYS).toEqual(["watchlist", "watchtags", "watchcols", "chartpacks", "screens", "risk"]);
    expect(isPrefKey("watchlist")).toBe(true);
    expect(isPrefKey("theme")).toBe(false);
  });

  it("stores only what the app can read back", () => {
    expect(normalizePref("watchlist", ["aapl", "AAPL", 7, "<b>", "msft"])).toEqual(["AAPL", "MSFT"]);
    expect(normalizePref("watchlist", { not: "a list" })).toBeNull();
    expect(normalizePref("watchtags", ["wrong"])).toBeNull();
    expect(normalizePref("watchtags", { AAPL: ["Core", "core"] })).toEqual({ AAPL: ["Core"] });
    expect(normalizePref("watchcols", ["insiders", "bogus"])).toEqual(["insiders"]);
    expect(normalizePref("chartpacks", [{ id: "essentials", name: "clash", charts: [] }])).toEqual([]); // built-in id
    expect(normalizePref("screens", [{ name: " Mine ", query: "roic=15" }, { name: "Mine", query: "x" }, { name: 3 }])).toEqual([{ name: "Mine", query: "roic=15" }]);
  });

  it("caps saved screens", () => {
    const many = Array.from({ length: MAX_SCREENS + 5 }, (_, i) => ({ name: `S${i}`, query: "" }));
    expect(parseScreens(many)).toHaveLength(MAX_SCREENS);
  });

  it("merges a device's first sync without losing either side", () => {
    expect(mergePref("watchlist", ["AAPL", "MSFT"], ["KO", "AAPL"])).toEqual(["AAPL", "MSFT", "KO"]);
    expect(mergePref("watchtags", { AAPL: ["Core"] }, { AAPL: ["core", "Tech"], KO: ["Dividends"] })).toEqual({ AAPL: ["Core", "Tech"], KO: ["Dividends"] });
    expect(mergePref("watchcols", ["quality"], ["insiders"])).toEqual(["quality"]); // one choice: the account's
    const pack = (id: string) => ({ id, name: id, charts: [] });
    expect((mergePref("chartpacks", [pack("p-a")], [pack("p-a"), pack("p-b")]) as { id: string }[]).map((p) => p.id)).toEqual(["p-a", "p-b"]);
    expect(mergePref("screens", [{ name: "A", query: "1" }], [{ name: "A", query: "2" }, { name: "B", query: "3" }])).toEqual([
      { name: "A", query: "1" },
      { name: "B", query: "3" },
    ]);
  });

  it("treats a new device's defaults as empty, except the column choice", () => {
    expect(isEmptyPref("watchlist", [])).toBe(true);
    expect(isEmptyPref("watchtags", {})).toBe(true);
    expect(isEmptyPref("watchcols", [])).toBe(false);
    expect(isEmptyPref("screens", [{ name: "A", query: "" }])).toBe(false);
  });
});

describe("sync plan per device", () => {
  const acct = (value: unknown, updatedAt = "2026-11-19T10:00:00.000Z") => ({ value, updatedAt });

  it("first sync: uploads a device's list when the account has none, skips empty defaults", () => {
    expect(planSync("watchlist", undefined, ["AAPL"], null, false)).toEqual({ upload: true });
    expect(planSync("watchlist", undefined, [], null, false)).toEqual({ upload: false, mark: "" });
  });

  it("first sync: merges with the account and uploads only if the device added something", () => {
    expect(planSync("watchlist", acct(["AAPL"]), ["KO"], null, false)).toEqual({ apply: ["AAPL", "KO"], upload: true });
    expect(planSync("watchlist", acct(["AAPL", "KO"]), ["KO"], null, false)).toEqual({ apply: ["AAPL", "KO"], upload: false, mark: "2026-11-19T10:00:00.000Z" });
  });

  it("later: takes a newer account version, keeps pending local edits, and does nothing otherwise", () => {
    const a = acct(["MSFT"], "2026-11-19T11:00:00.000Z");
    expect(planSync("watchlist", a, ["AAPL"], "2026-11-19T10:00:00.000Z", false)).toEqual({ apply: ["MSFT"], upload: false, mark: "2026-11-19T11:00:00.000Z" });
    expect(planSync("watchlist", a, ["AAPL"], "2026-11-19T10:00:00.000Z", true)).toEqual({ upload: true });
    expect(planSync("watchlist", a, ["MSFT"], "2026-11-19T11:00:00.000Z", false)).toEqual({ upload: false });
  });
});

describe("risk settings (guided plan)", () => {
  it("are an object, empty until an account size is set, and the account's choice wins once it has one", () => {
    expect(normalizePref("risk", { account: 5000, pct: 0.02 })).toEqual({ account: 5000, pct: 0.02 });
    expect(normalizePref("risk", [1])).toBeNull();
    expect(isEmptyPref("risk", { account: null, pct: 0.01 })).toBe(true);
    expect(mergePref("risk", { account: 8000, pct: 0.01 }, { account: 3000, pct: 0.02 })).toEqual({ account: 8000, pct: 0.01 });
    expect(mergePref("risk", { account: null, pct: 0.01 }, { account: 3000, pct: 0.02 })).toEqual({ account: 3000, pct: 0.02 });
  });
});
