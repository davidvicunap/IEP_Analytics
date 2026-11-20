import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { normalizeSymbol } from "@/lib/data";
import { getExplanation } from "@/lib/explainData";
import { checkRateLimit } from "@/lib/ratelimit";
import { notebookOwner, sameOrigin } from "@/lib/researchServer";
import type { DataIssue } from "@/lib/types";

export const maxDuration = 60;

type Ctx = { params: Promise<{ symbol: string }> };
const NO_STORE = { "Cache-Control": "private, no-store" };
const STATUS: Partial<Record<DataIssue, number>> = { not_found: 404, not_configured: 503, rate_limited: 429, unauthorized: 502 };

async function handle(request: Request, ctx: Ctx, write: boolean) {
  const symbol = normalizeSymbol((await ctx.params).symbol);
  if (!symbol) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404, headers: NO_STORE });
  const lang = new URL(request.url).searchParams.get("lang") === "en" ? "en" : "es";
  if (write) {
    if (!sameOrigin(request)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403, headers: NO_STORE });
    // Each new explanation costs money: a few per person every ten minutes.
    const owner = (await notebookOwner(await cookies())) ?? "anonymous";
    const limit = await checkRateLimit("explain", owner);
    if (!limit.ok) return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429, headers: { ...NO_STORE, "Retry-After": String(limit.retryAfter) } });
  }
  const r = await getExplanation(symbol, lang, { write });
  if (!r.ok) return NextResponse.json(r, { status: STATUS[r.error] ?? 502, headers: NO_STORE });
  return NextResponse.json(r, { headers: NO_STORE });
}

/** The explanation already written for the current facts (or the facts and whether one can be written). */
export const GET = (request: Request, ctx: Ctx) => handle(request, ctx, false);

/** Writes the explanation if there isn't one for the current facts. */
export const POST = (request: Request, ctx: Ctx) => handle(request, ctx, true);
