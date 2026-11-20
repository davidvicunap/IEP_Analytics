import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { normalizeSymbol } from "@/lib/data";
import { emptyNote } from "@/lib/research";
import { notebookOwner, researchStore } from "@/lib/researchServer";
import { alertStore } from "@/lib/thesisAlertStore";
import { checkThesis, factsCache, marketDate } from "@/lib/thesesData";

export const maxDuration = 30;
const HISTORY = 50;

type Ctx = { params: Promise<{ symbol: string }> };

/** One live thesis, checked now, with the alerts it has raised (active and cleared). */
export async function GET(_request: Request, ctx: Ctx) {
  const headers = { "Cache-Control": "private, no-store" };
  const symbol = normalizeSymbol((await ctx.params).symbol);
  if (!symbol) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404, headers });
  const owner = await notebookOwner(await cookies());
  if (!owner) return NextResponse.json({ error: "beta_required" }, { status: 401, headers });
  const notes = researchStore();
  const alerts = alertStore();
  if (!notes || !alerts) return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503, headers });
  try {
    const now = new Date();
    const note = (await notes.get(owner, symbol)) ?? emptyNote(symbol);
    const view = await checkThesis(owner, note, alerts, factsCache(marketDate(now)), now);
    const history = await alerts.history(owner, symbol, HISTORY);
    return NextResponse.json({ ok: true, data: { ...view, history }, fetchedAt: now.toISOString() }, { headers });
  } catch (e) {
    console.error(JSON.stringify({ event: "theses_error", message: e instanceof Error ? e.message : String(e) }));
    return NextResponse.json({ ok: false, error: "upstream" }, { status: 502, headers });
  }
}
