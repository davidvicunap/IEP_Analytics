import { cookies } from "next/headers";
import { NextResponse, after } from "next/server";
import { normalizeSymbol } from "@/lib/data";
import { emptyNote } from "@/lib/research";
import { notebookOwner, researchStore, sameOrigin } from "@/lib/researchServer";
import { alertStore } from "@/lib/thesisAlertStore";
import { checkThesis, factsCache, marketDate } from "@/lib/thesesData";
import { notifyFired, recordingFires } from "@/lib/thesisNotify";
import { symbolInfoMap } from "@/lib/symbolsData";

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
  const store = alertStore();
  if (!notes || !store) return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503, headers });
  try {
    const now = new Date();
    const note = (await notes.get(owner, symbol)) ?? emptyNote(symbol);
    const { alerts, fired } = recordingFires(store);
    const info = (await symbolInfoMap([symbol])).get(symbol);
    const view = await checkThesis(owner, note, alerts, factsCache(marketDate(now)), now, { splits: info?.splits, listing: info?.listing, notes });
    if (fired.size) after(() => notifyFired(fired, { now }));
    const history = await alerts.history(owner, symbol, HISTORY);
    return NextResponse.json({ ok: true, data: { ...view, history }, fetchedAt: now.toISOString() }, { headers });
  } catch (e) {
    console.error(JSON.stringify({ event: "theses_error", message: e instanceof Error ? e.message : String(e) }));
    return NextResponse.json({ ok: false, error: "upstream" }, { status: 502, headers });
  }
}

/** Marks an active alert as seen: `{ dismiss: key }`. It leaves the home page and stays on the thesis. */
export async function POST(request: Request, ctx: Ctx) {
  const headers = { "Cache-Control": "private, no-store" };
  const symbol = normalizeSymbol((await ctx.params).symbol);
  if (!symbol) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404, headers });
  if (!sameOrigin(request)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403, headers });
  const owner = await notebookOwner(await cookies());
  if (!owner) return NextResponse.json({ error: "beta_required" }, { status: 401, headers });
  const alerts = alertStore();
  if (!alerts) return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503, headers });
  const body = (await request.json().catch(() => null)) as { dismiss?: unknown } | null;
  const key = body?.dismiss;
  if (typeof key !== "string" || !key || key.length > 200) return NextResponse.json({ ok: false, error: "invalid" }, { status: 400, headers });
  try {
    const found = await alerts.dismiss(owner, symbol, key, new Date());
    return found ? NextResponse.json({ ok: true, data: { key }, fetchedAt: new Date().toISOString() }, { headers }) : NextResponse.json({ ok: false, error: "not_found" }, { status: 404, headers });
  } catch (e) {
    console.error(JSON.stringify({ event: "theses_error", message: e instanceof Error ? e.message : String(e) }));
    return NextResponse.json({ ok: false, error: "upstream" }, { status: 502, headers });
  }
}
