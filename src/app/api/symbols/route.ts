import { NextResponse } from "next/server";
import { normalizeSymbol } from "@/lib/data";
import { getSymbolInfo } from "@/lib/symbolsData";

const MAX = 100;

/** `?s=AAPL,FB`: for each ticker, whether it still trades (or its new ticker) and its detected splits. */
export async function GET(request: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  const raw = new URL(request.url).searchParams.get("s") ?? "";
  const symbols = [...new Set(raw.split(",").map((x) => normalizeSymbol(x)).filter((x): x is string => !!x))].slice(0, MAX);
  try {
    return NextResponse.json({ ok: true, data: await getSymbolInfo(symbols), fetchedAt: new Date().toISOString() }, { headers });
  } catch (e) {
    console.error(JSON.stringify({ event: "symbols_error", message: e instanceof Error ? e.message : String(e) }));
    return NextResponse.json({ ok: false, error: "upstream" }, { status: 502, headers });
  }
}
