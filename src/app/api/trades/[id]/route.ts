import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { notebookOwner, sameOrigin } from "@/lib/researchServer";
import { tradeStore } from "@/lib/tradeStore";
import { book } from "@/lib/trades";

const headers = { "Cache-Control": "private, no-store" };
const fail = (error: string, status: number) => NextResponse.json({ ok: false, error }, { status, headers });

/**
 * Deletes one trade. A buy that a later sell depends on is refused (409 `oversold`): the sell
 * has to go first, so the record never shows shares sold that were never bought.
 */
export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request)) return fail("forbidden", 403);
  const owner = await notebookOwner(await cookies());
  if (!owner) return fail("beta_required", 401);
  const store = tradeStore();
  if (!store) return fail("not_configured", 503);
  const { id } = await ctx.params;
  if (!/^[\w-]{1,64}$/.test(id)) return fail("not_found", 404);
  try {
    const all = await store.list(owner);
    if (!all.some((t) => t.id === id)) return fail("not_found", 404);
    if (book(all.filter((t) => t.id !== id)).oversold.length > book(all).oversold.length) return fail("oversold", 409);
    await store.remove(owner, id);
    return NextResponse.json({ ok: true, data: { id }, fetchedAt: new Date().toISOString() }, { headers });
  } catch (e) {
    console.error(JSON.stringify({ event: "trades_error", message: e instanceof Error ? e.message : String(e) }));
    return fail("upstream", 502);
  }
}
