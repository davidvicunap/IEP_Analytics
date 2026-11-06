// Private beta gate.
//
// Invite codes live in BETA_INVITE_CODES as a comma- or newline-separated list,
// each optionally labelled: "owner:IEP-7K2M-9QXD-4HTR,tester1:IEP-...".
// The access cookie holds HMAC-SHA256(code, TOKEN_CONTEXT), so:
//   - no extra secret is needed,
//   - removing a code from the env var revokes everyone who entered with it.
// The gate is on unless BETA_GATE=off, and it fails closed when no codes are set.

export const BETA_COOKIE = "iep_beta";
export const BETA_COOKIE_MAX_AGE = 60 * 60 * 24 * 90; // 90 days
const TOKEN_CONTEXT = "iep-beta-v1";
const MIN_CODE_LENGTH = 10;

export interface InviteCode {
  label: string;
  code: string; // normalized
}

/** Uppercase, strip separators and map look-alike characters (Crockford style). */
export function normalizeCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
}

export function parseInviteCodes(env: string | undefined): InviteCode[] {
  if (!env) return [];
  return env
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry, i) => {
      const sep = entry.indexOf(":");
      const label = sep > 0 ? entry.slice(0, sep).trim() : `code${i + 1}`;
      const code = normalizeCode(sep > 0 ? entry.slice(sep + 1) : entry);
      return { label, code };
    })
    .filter((c) => c.code.length >= MIN_CODE_LENGTH);
}

export function isGateEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env.BETA_GATE ?? "on").trim().toLowerCase() !== "off";
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const encoder = new TextEncoder();

async function hmacHex(key: string, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function tokenForCode(code: string): Promise<string> {
  return hmacHex(code, TOKEN_CONTEXT);
}

/** Returns the invite code a user typed, or null. Compares every code in constant time. */
export function matchCode(input: string, codes: InviteCode[]): InviteCode | null {
  const typed = normalizeCode(input);
  let found: InviteCode | null = null;
  for (const c of codes) if (constantTimeEqual(c.code, typed)) found = c;
  return found;
}

// Tokens are recomputed only when BETA_INVITE_CODES changes.
let tokenCache: { key: string; tokens: Map<string, InviteCode> } | null = null;

async function tokensFor(codes: InviteCode[]): Promise<Map<string, InviteCode>> {
  const key = codes.map((c) => `${c.label}:${c.code}`).join(",");
  if (tokenCache?.key === key) return tokenCache.tokens;
  const tokens = new Map<string, InviteCode>();
  for (const c of codes) tokens.set(await tokenForCode(c.code), c);
  tokenCache = { key, tokens };
  return tokens;
}

/** Returns the invite code behind a cookie token, or null if it is missing or revoked. */
export async function verifyToken(token: string | undefined, codes: InviteCode[]): Promise<InviteCode | null> {
  if (!token || codes.length === 0) return null;
  let found: InviteCode | null = null;
  for (const [expected, code] of await tokensFor(codes)) {
    if (constantTimeEqual(expected, token)) found = code;
  }
  return found;
}

/** Only same-origin paths are allowed after login, never the gate itself. */
export function safeNextPath(next: string | null | undefined): string {
  if (!next) return "/";
  try {
    const base = "http://iep.invalid";
    const url = new URL(next, base);
    if (url.origin !== base || !next.startsWith("/")) return "/";
    const path = url.pathname + url.search;
    return path === "/beta" || path.startsWith("/beta/") || path.startsWith("/beta?") ? "/" : path;
  } catch {
    return "/";
  }
}
