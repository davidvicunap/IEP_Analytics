import { cookies } from "next/headers";
import { NextResponse, after } from "next/server";
import { notebookOwner, researchStore } from "@/lib/researchServer";
import { alertStore } from "@/lib/thesisAlertStore";
import { checkTheses, factsCache, marketDate } from "@/lib/thesesData";
import { notifyFired, recordingFires } from "@/lib/thesisNotify";

export const maxDuration = 30;

/** The user's live theses, checked now: status and active alerts for each. */
export async function GET() {
  const headers = { "Cache-Control": "private, no-store" };
  const owner = await notebookOwner(await cookies());
  if (!owner) return NextResponse.json({ error: "beta_required" }, { status: 401, headers });
  const notes = researchStore();
  const store = alertStore();
  if (!notes || !store) return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503, headers });
  try {
    const now = new Date();
    // Alerts that fire now also go to the owner's phones, after the response.
    const { alerts, fired } = recordingFires(store);
    const data = await checkTheses(owner, await notes.list(owner), alerts, factsCache(marketDate(now)), now);
    if (fired.size) after(() => notifyFired(fired, { now }));
    return NextResponse.json({ ok: true, data, fetchedAt: now.toISOString() }, { headers });
  } catch (e) {
    console.error(JSON.stringify({ event: "theses_error", message: e instanceof Error ? e.message : String(e) }));
    return NextResponse.json({ ok: false, error: "upstream" }, { status: 502, headers });
  }
}
