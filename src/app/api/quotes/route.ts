import { NextResponse } from "next/server";
import { getQuotes } from "@/lib/data";

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("symbols") ?? "";
  const quotes = await getQuotes(raw.split(",").filter(Boolean));
  return NextResponse.json(quotes, { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } });
}
