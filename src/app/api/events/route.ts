import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { recordEvent } from "@/lib/eventStore";
import { cleanProps, isEventName } from "@/lib/funnel";
import { notebookOwner, sameOrigin } from "@/lib/researchServer";

/** Records one product event for this beta label: `{ name, props? }` (known names only). */
export async function POST(request: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  if (!sameOrigin(request)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403, headers });
  const owner = await notebookOwner(await cookies());
  if (!owner) return NextResponse.json({ error: "beta_required" }, { status: 401, headers });
  const body = (await request.json().catch(() => null)) as { name?: unknown; props?: unknown } | null;
  // alert_sent is recorded by the server only.
  if (!isEventName(body?.name) || body.name === "alert_sent") return NextResponse.json({ ok: false, error: "invalid" }, { status: 400, headers });
  await recordEvent(owner, body.name, cleanProps(body.props));
  return NextResponse.json({ ok: true, data: { recorded: true }, fetchedAt: new Date().toISOString() }, { headers });
}
