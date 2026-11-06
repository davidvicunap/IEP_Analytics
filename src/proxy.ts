import { NextResponse, type NextRequest } from "next/server";
import { BETA_COOKIE, isGateEnabled, parseInviteCodes, verifyToken } from "@/lib/beta";

// Paths reachable without an invite: the gate page and its login endpoint.
const OPEN_PATHS = ["/beta", "/api/beta"];

function noindex(res: NextResponse): NextResponse {
  res.headers.set("X-Robots-Tag", "noindex, nofollow");
  return res;
}

export async function proxy(request: NextRequest) {
  if (!isGateEnabled()) return NextResponse.next();

  const { pathname, search } = request.nextUrl;
  if (OPEN_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return noindex(NextResponse.next());
  }

  const codes = parseInviteCodes(process.env.BETA_INVITE_CODES);
  const invite = await verifyToken(request.cookies.get(BETA_COOKIE)?.value, codes);
  if (invite) return noindex(NextResponse.next());

  if (pathname.startsWith("/api/")) {
    return noindex(NextResponse.json({ error: "beta_required" }, { status: 401 }));
  }

  const url = request.nextUrl.clone();
  url.pathname = "/beta";
  url.search = "";
  if (pathname !== "/") url.searchParams.set("next", pathname + search);
  return noindex(NextResponse.redirect(url));
}

export const config = {
  // Everything except build assets and public files that reveal no data.
  matcher: ["/((?!_next/static|_next/image|icon.svg|favicon.ico|robots.txt).*)"],
};
