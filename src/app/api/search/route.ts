import { NextResponse } from "next/server";
import { searchSymbols } from "@/lib/data";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q") ?? "";
  const result = await searchSymbols(q);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 503 });
  return NextResponse.json(result.data, { headers: { "Cache-Control": "private, max-age=300" } });
}
