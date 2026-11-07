import { NextResponse } from "next/server";
import { normalizeSymbol } from "@/lib/data";
import { getComps, MAX_PEERS } from "@/lib/compsData";

export const maxDuration = 30;

/**
 * Comps for a ticker: ?symbol=AAPL&peers=MSFT,DELL (no `peers` = suggested from its SIC group).
 * Uses licensed market caps, so it stays behind the beta gate.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const symbol = normalizeSymbol(url.searchParams.get("symbol") ?? "");
  if (!symbol) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  const raw = url.searchParams.get("peers");
  const peers =
    raw === null
      ? null
      : raw
          .split(",")
          .map((s) => normalizeSymbol(s))
          .filter((s): s is string => s !== null)
          .slice(0, MAX_PEERS);
  const result = await getComps(symbol, peers);
  const status = result.ok ? 200 : result.error === "not_found" ? 404 : result.error === "not_configured" ? 503 : 502;
  return NextResponse.json(result, { status, headers: { "Cache-Control": "private, no-store" } });
}
