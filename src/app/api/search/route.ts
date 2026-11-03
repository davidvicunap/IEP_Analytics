import { NextResponse } from "next/server";
import { searchSymbols } from "@/lib/data";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q") ?? "";
  const results = await searchSymbols(q);
  return NextResponse.json(results, { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } });
}
