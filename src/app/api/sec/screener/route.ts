import { NextResponse } from "next/server";
import { parseScreen, runScreen, type ScreenerPayload } from "@/lib/screener";
import { getUniverse } from "@/lib/screenerData";

export const maxDuration = 30;

/** Companies matching the screen in the query string (see lib/screener.ts). Public SEC data. */
export async function GET(req: Request) {
  const u = await getUniverse();
  if (!u.ok) {
    const status = u.error === "not_found" ? 404 : u.error === "not_configured" ? 503 : 502;
    return NextResponse.json(u, { status, headers: { "Cache-Control": "no-store" } });
  }
  const screen = parseScreen(new URL(req.url).searchParams);
  const { matched, rows } = runScreen(u.data.rows, screen, 100);
  const data: ScreenerPayload = { year: u.data.year, updatedAt: u.data.updatedAt, total: u.data.rows.length, matched, rows };
  return NextResponse.json(
    { ok: true, data, fetchedAt: u.fetchedAt },
    { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } },
  );
}
