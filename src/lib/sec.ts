// SEC EDGAR client. SEC data is public; the SEC asks every client to identify itself
// with a User-Agent that includes contact details, and to stay under 10 requests/second.
import type { NewSecurity } from "@/db/schema";

export const SEC_TICKERS_URL = "https://www.sec.gov/files/company_tickers_exchange.json";

const LISTED_EXCHANGES = new Set(["NASDAQ", "NYSE", "CBOE"]);

export function secUserAgent(env: Record<string, string | undefined> = process.env): string {
  return env.SEC_USER_AGENT?.trim() || "IEP Analytics https://iepanalytics.vercel.app";
}

/**
 * Parses company_tickers_exchange.json: {fields: ["cik","name","ticker","exchange"], data: [[...], ...]}.
 * Keeps exchange-listed tickers only (drops OTC and rows without an exchange). Throws on an unexpected shape.
 */
export function parseCompanyTickers(json: unknown): Omit<NewSecurity, "updatedAt">[] {
  if (!json || typeof json !== "object") throw new Error("sec: unexpected payload");
  const { fields, data } = json as { fields?: unknown; data?: unknown };
  if (!Array.isArray(fields) || !Array.isArray(data)) throw new Error("sec: missing fields/data");
  const col = (name: string) => {
    const i = fields.indexOf(name);
    if (i < 0) throw new Error(`sec: missing column ${name}`);
    return i;
  };
  const [iCik, iName, iTicker, iExchange] = [col("cik"), col("name"), col("ticker"), col("exchange")];

  const bySymbol = new Map<string, Omit<NewSecurity, "updatedAt">>();
  for (const row of data) {
    if (!Array.isArray(row)) continue;
    const cik = Number(row[iCik]);
    const name = typeof row[iName] === "string" ? row[iName].trim() : "";
    const symbol = typeof row[iTicker] === "string" ? row[iTicker].trim().toUpperCase() : "";
    const exchange = typeof row[iExchange] === "string" ? row[iExchange].trim().toUpperCase() : "";
    if (!Number.isInteger(cik) || cik <= 0 || !name || !/^[A-Z][A-Z.\-]{0,9}$/.test(symbol)) continue;
    if (!LISTED_EXCHANGES.has(exchange)) continue;
    if (!bySymbol.has(symbol)) bySymbol.set(symbol, { symbol, cik, name, exchange, active: true, source: "SEC" });
  }
  return [...bySymbol.values()];
}

export async function fetchCompanyTickers(): Promise<Omit<NewSecurity, "updatedAt">[]> {
  const res = await fetch(SEC_TICKERS_URL, {
    headers: { "User-Agent": secUserAgent(), Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`sec: HTTP ${res.status}`);
  return parseCompanyTickers(await res.json());
}
