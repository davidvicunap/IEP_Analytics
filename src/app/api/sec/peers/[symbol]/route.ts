import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { normalizeSymbol } from "@/lib/data";
import { ensureSic, latestMetricsYear, suggestedPeers } from "@/lib/peers";
import { getSecurity } from "@/lib/securities";

export const maxDuration = 30;
const PEERS = 6;

export interface PeersPayload {
  symbol: string;
  sicDescription: string | null;
  peers: string[]; // largest listed companies in the same industry group, closest first
}

/** Suggested peers for charts (public SEC data: industry codes and filer list). */
export async function GET(_req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const symbol = normalizeSymbol((await params).symbol);
  const db = getDb();
  if (!symbol) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  if (!db) return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
  try {
    const security = await getSecurity(db, symbol);
    if (!security) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    const [{ sic, sicDescription }, latest] = await Promise.all([ensureSic(db, security.cik), latestMetricsYear(db)]);
    const peers = sic && latest ? await suggestedPeers(db, sic, latest.year, security.cik, PEERS) : [];
    const data: PeersPayload = { symbol: security.symbol, sicDescription, peers };
    return NextResponse.json({ ok: true, data, fetchedAt: new Date().toISOString() }, { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" } });
  } catch (e) {
    console.error(JSON.stringify({ event: "peers_error", symbol, message: e instanceof Error ? e.message : String(e) }));
    return NextResponse.json({ ok: false, error: "upstream" }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
