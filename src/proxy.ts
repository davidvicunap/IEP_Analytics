import { NextResponse, type NextRequest } from "next/server";
import { BETA_COOKIE, isGateEnabled, parseInviteCodes, verifyToken } from "@/lib/beta";
import { checkRateLimit, clientIp } from "@/lib/ratelimit";

// Reachable without an invite: the gate page and its login endpoint, the health check
// (no market data), cron routes (they check CRON_SECRET themselves) and SEC data
// (public domain, not covered by the FMP license).
const OPEN_PATHS = ["/beta", "/api/beta", "/api/health", "/api/cron", "/api/sec"];

function noindex(res: NextResponse): NextResponse {
  res.headers.set("X-Robots-Tag", "noindex, nofollow");
  return res;
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // Rate limits apply to every API call, before the gate (no-op without Redis).
  if (pathname.startsWith("/api/") && !pathname.startsWith("/api/cron")) {
    const kind = pathname === "/api/beta" && request.method === "POST" ? "login" : "api";
    const limit = await checkRateLimit(kind, clientIp(request.headers));
    if (!limit.ok) {
      return noindex(
        NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } }),
      );
    }
  }

  if (!isGateEnabled()) return NextResponse.next();

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
