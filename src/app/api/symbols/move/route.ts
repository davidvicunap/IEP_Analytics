import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { normalizeSymbol } from "@/lib/data";
import { notebookOwner, researchStore, sameOrigin } from "@/lib/researchServer";
import { getSymbolInfo } from "@/lib/symbolsData";
import { alertStore } from "@/lib/thesisAlertStore";
import { tradeStore } from "@/lib/tradeStore";

const headers = { "Cache-Control": "private, no-store" };
const fail = (error: string, status: number) => NextResponse.json({ ok: false, error }, { status, headers });

export interface MoveResult {
  note: boolean;
  trades: number;
}

/**
 * Moves a renamed ticker's notebook, alerts and trades to its new ticker: `{ from, to }`. Only
 * for a rename the SEC list confirms (400 otherwise); 409 when the new ticker already has a notebook.
 */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return fail("forbidden", 403);
  const owner = await notebookOwner(await cookies());
  if (!owner) return fail("beta_required", 401);
  const notes = researchStore();
  const alerts = alertStore();
  const trades = tradeStore();
  if (!notes || !alerts || !trades) return fail("not_configured", 503);
  const body = (await request.json().catch(() => null)) as { from?: unknown; to?: unknown } | null;
  const from = typeof body?.from === "string" ? normalizeSymbol(body.from) : null;
  const to = typeof body?.to === "string" ? normalizeSymbol(body.to) : null;
  if (!from || !to || from === to) return fail("invalid", 400);
  try {
    const [info] = await getSymbolInfo([from]);
    if (info?.listing.status !== "renamed" || info.listing.to !== to) return fail("invalid", 400);
    const note = await notes.rename(owner, from, to);
    if (note === "conflict") return fail("conflict", 409);
    if (note === "ok") await alerts.rename(owner, from, to);
    const moved = await trades.rename(owner, from, to);
    return NextResponse.json({ ok: true, data: { note: note === "ok", trades: moved } satisfies MoveResult, fetchedAt: new Date().toISOString() }, { headers });
  } catch (e) {
    console.error(JSON.stringify({ event: "symbol_move_error", message: e instanceof Error ? e.message : String(e) }));
    return fail("upstream", 502);
  }
}
