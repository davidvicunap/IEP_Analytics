import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { notebookOwner, researchStore } from "@/lib/researchServer";

/** All of the user's notebooks, most recently edited first. */
export async function GET() {
  const headers = { "Cache-Control": "private, no-store" };
  const owner = await notebookOwner(await cookies());
  if (!owner) return NextResponse.json({ error: "beta_required" }, { status: 401, headers });
  const store = researchStore();
  if (!store) return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503, headers });
  try {
    return NextResponse.json({ ok: true, data: await store.list(owner), fetchedAt: new Date().toISOString() }, { headers });
  } catch (e) {
    console.error(JSON.stringify({ event: "research_error", message: e instanceof Error ? e.message : String(e) }));
    return NextResponse.json({ ok: false, error: "upstream" }, { status: 502, headers });
  }
}
