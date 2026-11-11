import { NextResponse } from "next/server";
import { normalizeSymbol } from "@/lib/data";
import { SECTION_KEYS, type SectionKey } from "@/lib/filingReader";
import { getReport } from "@/lib/filingReaderData";

export const maxDuration = 60;

/** One section of a 10-K for the filing reader: ?s=business|risks|mdna&accn= (public SEC data). */
export async function GET(req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const symbol = normalizeSymbol((await params).symbol);
  const url = new URL(req.url);
  const s = url.searchParams.get("s") ?? "business";
  const accn = url.searchParams.get("accn");
  if (!symbol || !(SECTION_KEYS as readonly string[]).includes(s) || (accn !== null && !/^\d{10}-\d{2}-\d{6}$/.test(accn))) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  const result = await getReport(symbol, accn, s as SectionKey);
  const status = result.ok ? 200 : result.error === "not_found" ? 404 : result.error === "not_configured" ? 503 : 502;
  // A specific filing never changes; "the latest" does when a new 10-K arrives.
  const cache = !result.ok || result.data.risksNote === "priorUnavailable" ? "no-store" : accn ? "public, s-maxage=86400, stale-while-revalidate=604800" : "public, s-maxage=3600, stale-while-revalidate=86400";
  return NextResponse.json(result, { status, headers: { "Cache-Control": cache } });
}
