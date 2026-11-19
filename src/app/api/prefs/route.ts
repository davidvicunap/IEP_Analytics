import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { prefsStore } from "@/lib/prefsStore";
import { notebookOwner } from "@/lib/researchServer";

/** Every synced setting of the signed-in person (behind the beta gate, never cached). */
export async function GET() {
  const owner = await notebookOwner(await cookies());
  if (!owner) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const store = prefsStore();
  if (!store) return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
  try {
    const data = await store.all(owner);
    return NextResponse.json({ ok: true, data, fetchedAt: new Date().toISOString() }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    console.error(JSON.stringify({ event: "prefs_read_error", message: e instanceof Error ? e.message : String(e) }));
    return NextResponse.json({ ok: false, error: "upstream" }, { status: 502 });
  }
}
