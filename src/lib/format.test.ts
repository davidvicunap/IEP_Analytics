import { describe, expect, it } from "vitest";
import { fmtAsOf } from "./format";

describe("fmtAsOf", () => {
  it("shows New York market time whatever the viewer's zone", () => {
    // 2026-11-06 21:00 UTC is 16:00 in New York (EST, UTC-5, after the 1 Nov DST change).
    expect(fmtAsOf("2026-11-06T21:00:00Z", "es")).toMatch(/16:00 ET$/);
    expect(fmtAsOf("2026-11-06T21:00:00Z", "en")).toMatch(/16:00 ET$/);
    // During daylight time New York is UTC-4.
    expect(fmtAsOf("2026-07-01T20:00:00Z", "en")).toMatch(/16:00 ET$/);
  });

  it("handles missing or invalid input", () => {
    expect(fmtAsOf(undefined, "es")).toBe("—");
    expect(fmtAsOf("not a date", "es")).toBe("—");
  });
});
