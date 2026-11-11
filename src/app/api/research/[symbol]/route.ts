import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { normalizeSymbol } from "@/lib/data";
import { emptyNote, parseInput } from "@/lib/research";
import { notebookOwner, researchStore, sameOrigin } from "@/lib/researchServer";

const NO_STORE = { "Cache-Control": "private, no-store" };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

type Ctx = { params: Promise<{ symbol: string }> };

async function context(request: Request, ctx: Ctx, write: boolean) {
  const symbol = normalizeSymbol((await ctx.params).symbol);
  if (!symbol) return { error: json({ ok: false, error: "not_found" }, 404) };
  if (write && !sameOrigin(request)) return { error: json({ ok: false, error: "forbidden" }, 403) };
  const owner = await notebookOwner(await cookies());
  if (!owner) return { error: json({ error: "beta_required" }, 401) };
  const store = researchStore();
  if (!store) return { error: json({ ok: false, error: "not_configured" }, 503) };
  return { symbol, owner, store };
}

function failed(e: unknown) {
  console.error(JSON.stringify({ event: "research_error", message: e instanceof Error ? e.message : String(e) }));
  return json({ ok: false, error: "upstream" }, 502);
}

/** The user's notebook for a stock (an empty one, `updatedAt: null`, if they haven't started). */
export async function GET(request: Request, ctx: Ctx) {
  const c = await context(request, ctx, false);
  if ("error" in c) return c.error;
  try {
    const note = (await c.store.get(c.owner, c.symbol)) ?? emptyNote(c.symbol);
    return json({ ok: true, data: note, fetchedAt: new Date().toISOString() });
  } catch (e) {
    return failed(e);
  }
}

/** Applies an edit (partial). 409 `conflict` when a newer version was saved meanwhile. */
export async function PUT(request: Request, ctx: Ctx) {
  const c = await context(request, ctx, true);
  if ("error" in c) return c.error;
  const parsed = parseInput(await request.json().catch(() => null));
  if (!parsed.ok) return json({ ok: false, error: "invalid" }, 400);
  try {
    const r = await c.store.save(c.owner, c.symbol, parsed.input);
    if (!r.ok) return json({ ok: false, error: "conflict" }, 409);
    return json({ ok: true, data: r.note, fetchedAt: new Date().toISOString() });
  } catch (e) {
    return failed(e);
  }
}

/** Deletes the notebook for this stock. */
export async function DELETE(request: Request, ctx: Ctx) {
  const c = await context(request, ctx, true);
  if ("error" in c) return c.error;
  try {
    await c.store.remove(c.owner, c.symbol);
    return json({ ok: true });
  } catch (e) {
    return failed(e);
  }
}
