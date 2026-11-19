import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { PREF_MAX_BYTES, isPrefKey, normalizePref } from "@/lib/prefs";
import { prefsStore } from "@/lib/prefsStore";
import { notebookOwner, sameOrigin } from "@/lib/researchServer";

/** Saves one setting ({ value }), validated and normalized like the app reads it. */
export async function PUT(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  if (!isPrefKey(key)) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  if (!sameOrigin(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 403 });
  const owner = await notebookOwner(await cookies());
  if (!owner) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const store = prefsStore();
  if (!store) return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });

  const text = await req.text();
  if (text.length > PREF_MAX_BYTES) return NextResponse.json({ ok: false, error: "invalid" }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  }
  const value = normalizePref(key, (body as { value?: unknown } | null)?.value);
  if (value === null) return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  try {
    const { updatedAt } = await store.put(owner, key, value);
    return NextResponse.json({ ok: true, data: { value, updatedAt }, fetchedAt: updatedAt }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    console.error(JSON.stringify({ event: "prefs_write_error", key, message: e instanceof Error ? e.message : String(e) }));
    return NextResponse.json({ ok: false, error: "upstream" }, { status: 502 });
  }
}
