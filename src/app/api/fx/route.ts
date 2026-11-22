import { NextResponse } from "next/server";
import { getFxRate } from "@/lib/fxData";
import { isCurrency } from "@/lib/money";

/** `?c=MXN`: units of that currency per US dollar, with its source and time. Behind the beta gate. */
export async function GET(request: Request) {
  const c = new URL(request.url).searchParams.get("c");
  const headers = { "Cache-Control": "private, no-store" };
  if (!isCurrency(c)) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404, headers });
  const r = await getFxRate(c);
  return NextResponse.json(r, { status: r.ok ? 200 : r.error === "not_configured" ? 503 : 502, headers });
}
