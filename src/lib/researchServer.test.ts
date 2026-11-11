import { afterEach, describe, expect, it, vi } from "vitest";
import { BETA_COOKIE, parseInviteCodes, tokenForCode } from "./beta";
import { notebookOwner, sameOrigin } from "./researchServer";

const jar = (value?: string) => ({ get: (name: string) => (name === BETA_COOKIE && value ? { value } : undefined) });

afterEach(() => vi.unstubAllEnvs());

describe("notebook owner", () => {
  it("is the invite's label, so each invited person has their own notes", async () => {
    vi.stubEnv("BETA_GATE", "on");
    vi.stubEnv("BETA_INVITE_CODES", "david:IEP-AAAA-BBBB-CCCC,ana:IEP-DDDD-EEEE-FFFF");
    const [david, ana] = parseInviteCodes(process.env.BETA_INVITE_CODES); // the cookie holds a token of the normalized code
    expect(await notebookOwner(jar(await tokenForCode(david.code)))).toBe("david");
    expect(await notebookOwner(jar(await tokenForCode(ana.code)))).toBe("ana");
    expect(await notebookOwner(jar("forged"))).toBeNull();
    expect(await notebookOwner(jar())).toBeNull();
  });

  it("is 'local' with the gate off (local development)", async () => {
    vi.stubEnv("BETA_GATE", "off");
    expect(await notebookOwner(jar())).toBe("local");
  });
});

describe("same-origin writes", () => {
  const req = (origin?: string) => new Request("https://iep.example/api/research/AAPL", { method: "PUT", headers: origin ? { origin } : {} });
  it("accepts our own pages and refuses others", () => {
    expect(sameOrigin(req("https://iep.example"))).toBe(true);
    expect(sameOrigin(req())).toBe(true);
    expect(sameOrigin(req("https://evil.example"))).toBe(false);
    expect(sameOrigin(req("not a url"))).toBe(false);
  });
});
