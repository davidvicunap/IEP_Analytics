import { describe, expect, it } from "vitest";
import {
  isGateEnabled,
  matchCode,
  normalizeCode,
  parseInviteCodes,
  safeNextPath,
  tokenForCode,
  verifyToken,
} from "./beta";

const ENV = "owner:IEP-7K2M-9QXD-4HTR, tester:IEP-AB12-CD34-EF56\nIEP-ZZZZ-YYYY-XXXX,short:ABC";

describe("invite codes", () => {
  it("parses labelled, unlabelled and newline-separated codes and drops weak ones", () => {
    const codes = parseInviteCodes(ENV);
    expect(codes.map((c) => c.label)).toEqual(["owner", "tester", "code3"]);
    expect(codes[0].code).toBe(normalizeCode("IEP-7K2M-9QXD-4HTR"));
    expect(parseInviteCodes(undefined)).toEqual([]);
    expect(parseInviteCodes(" , ")).toEqual([]);
  });

  it("normalizes case, separators and look-alike characters", () => {
    expect(normalizeCode("iep-7k2m 9qxd-4htr")).toBe(normalizeCode("IEP7K2M9QXD4HTR"));
    expect(normalizeCode("O-I-L")).toBe("011");
  });

  it("matches what a user types regardless of formatting", () => {
    const codes = parseInviteCodes(ENV);
    expect(matchCode("iep 7k2m 9qxd 4htr", codes)?.label).toBe("owner");
    expect(matchCode("IEP-0000-0000-0000", codes)).toBeNull();
    expect(matchCode("", codes)).toBeNull();
    expect(matchCode("IEP-7K2M-9QXD-4HTR", [])).toBeNull();
  });
});

describe("access tokens", () => {
  it("verifies a token and revokes it when its code is removed", async () => {
    const codes = parseInviteCodes(ENV);
    const token = await tokenForCode(codes[1].code);
    expect((await verifyToken(token, codes))?.label).toBe("tester");
    const withoutTester = codes.filter((c) => c.label !== "tester");
    expect(await verifyToken(token, withoutTester)).toBeNull();
  });

  it("rejects missing, forged and empty-config tokens", async () => {
    const codes = parseInviteCodes(ENV);
    expect(await verifyToken(undefined, codes)).toBeNull();
    expect(await verifyToken("deadbeef", codes)).toBeNull();
    expect(await verifyToken(await tokenForCode(codes[0].code), [])).toBeNull();
  });

  it("does not expose the code in the token", async () => {
    const codes = parseInviteCodes(ENV);
    const token = await tokenForCode(codes[0].code);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(token).not.toContain(codes[0].code.toLowerCase());
  });
});

describe("gate switch and redirects", () => {
  it("is on by default and only turns off explicitly", () => {
    expect(isGateEnabled({})).toBe(true);
    expect(isGateEnabled({ BETA_GATE: "on" })).toBe(true);
    expect(isGateEnabled({ BETA_GATE: " OFF " })).toBe(false);
  });

  it("only allows same-origin paths after login", () => {
    expect(safeNextPath("/stock/AAPL?tab=chart")).toBe("/stock/AAPL?tab=chart");
    expect(safeNextPath(null)).toBe("/");
    expect(safeNextPath("//evil.com/x")).toBe("/");
    expect(safeNextPath("/\\evil.com")).toBe("/");
    expect(safeNextPath("https://evil.com")).toBe("/");
    expect(safeNextPath("javascript:alert(1)")).toBe("/");
    expect(safeNextPath("/beta")).toBe("/");
    expect(safeNextPath("/beta?next=/x")).toBe("/");
  });
});
