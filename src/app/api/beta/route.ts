import { NextResponse } from "next/server";
import { BETA_COOKIE, BETA_COOKIE_MAX_AGE, matchCode, parseInviteCodes, tokenForCode } from "@/lib/beta";

const FAILURE_DELAY_MS = 400;

/** Exchanges an invite code for the beta access cookie. */
export async function POST(request: Request) {
  let typed = "";
  try {
    const body: unknown = await request.json();
    if (body && typeof body === "object" && typeof (body as { code?: unknown }).code === "string") {
      typed = (body as { code: string }).code.slice(0, 64);
    }
  } catch {
    /* invalid JSON → treated as an empty code */
  }

  const codes = parseInviteCodes(process.env.BETA_INVITE_CODES);
  if (codes.length === 0) {
    console.warn(JSON.stringify({ event: "beta_closed", reason: "no_invite_codes_configured" }));
    return NextResponse.json({ error: "beta_closed" }, { status: 503 });
  }

  const invite = matchCode(typed, codes);
  if (!invite) {
    await new Promise((r) => setTimeout(r, FAILURE_DELAY_MS));
    return NextResponse.json({ error: "invalid_code" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(BETA_COOKIE, await tokenForCode(invite.code), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: BETA_COOKIE_MAX_AGE,
  });
  console.info(JSON.stringify({ event: "beta_login", invite: invite.label }));
  return res;
}

/** Leaves the beta on this device. */
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(BETA_COOKIE);
  return res;
}
