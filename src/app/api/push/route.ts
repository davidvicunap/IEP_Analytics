import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { parseLang, parseSubscription } from "@/lib/push";
import { pushStore, vapidKeys } from "@/lib/pushServer";
import { notebookOwner, sameOrigin } from "@/lib/researchServer";

const headers = { "Cache-Control": "private, no-store" };
const fail = (error: string, status: number) => NextResponse.json({ ok: false, error }, { status, headers });

export interface PushConfig {
  /** The server's public key, for the browser's subscription. */
  publicKey: string;
}

/** The public key the browser subscribes with (created once on first use). */
export async function GET() {
  const owner = await notebookOwner(await cookies());
  if (!owner) return fail("beta_required", 401);
  const store = pushStore();
  if (!store) return fail("not_configured", 503);
  try {
    const { publicKey } = await vapidKeys(store);
    return NextResponse.json({ ok: true, data: { publicKey } satisfies PushConfig, fetchedAt: new Date().toISOString() }, { headers });
  } catch (e) {
    console.error(JSON.stringify({ event: "push_keys_error", message: e instanceof Error ? e.message : String(e) }));
    return fail("upstream", 502);
  }
}

/** Saves this browser's subscription: `{ subscription, lang }`. Saving again updates it. */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return fail("forbidden", 403);
  const owner = await notebookOwner(await cookies());
  if (!owner) return fail("beta_required", 401);
  const store = pushStore();
  if (!store) return fail("not_configured", 503);
  const body = (await request.json().catch(() => null)) as { subscription?: unknown; lang?: unknown } | null;
  const sub = parseSubscription(body?.subscription);
  if (!sub) return fail("invalid", 400);
  try {
    await store.save(owner, sub, parseLang(body?.lang), new Date());
    return NextResponse.json({ ok: true, data: { saved: true }, fetchedAt: new Date().toISOString() }, { headers });
  } catch (e) {
    console.error(JSON.stringify({ event: "push_save_error", message: e instanceof Error ? e.message : String(e) }));
    return fail("upstream", 502);
  }
}

/** Stops sending to this browser: `{ endpoint }`. */
export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return fail("forbidden", 403);
  const owner = await notebookOwner(await cookies());
  if (!owner) return fail("beta_required", 401);
  const store = pushStore();
  if (!store) return fail("not_configured", 503);
  const body = (await request.json().catch(() => null)) as { endpoint?: unknown } | null;
  if (typeof body?.endpoint !== "string" || body.endpoint.length > 1000) return fail("invalid", 400);
  try {
    await store.remove(owner, body.endpoint);
    return NextResponse.json({ ok: true, data: { removed: true }, fetchedAt: new Date().toISOString() }, { headers });
  } catch (e) {
    console.error(JSON.stringify({ event: "push_delete_error", message: e instanceof Error ? e.message : String(e) }));
    return fail("upstream", 502);
  }
}
