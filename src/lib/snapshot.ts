// Server-side: a hub row's summary of one stock, from public SEC data only (no FMP quota): its
// latest report, this week's filings and when results are next expected. One database read and
// the filings list (cached), so a row answers in milliseconds and the CDN can keep it.
import { getDb } from "@/db/client";
import { getFilings } from "./filings";
import { getSecurity } from "./securities";
import { pickFilings, type SnapshotPayload } from "./snapshotShared";
import type { Result } from "./types";

export async function getSnapshot(symbol: string): Promise<Result<SnapshotPayload>> {
  const db = getDb();
  if (!db) return { ok: false, error: "not_configured" };
  let security;
  try {
    security = await getSecurity(db, symbol);
  } catch {
    return { ok: false, error: "upstream" };
  }
  if (!security) return { ok: false, error: "not_found" };
  const r = await getFilings(security.symbol);
  const filings: SnapshotPayload["filings"] = r.ok ? { ok: true, data: pickFilings(r.data.filings) } : { ok: false, error: r.error };
  return { ok: true, data: { symbol: security.symbol, cik: security.cik, filings }, fetchedAt: new Date().toISOString() };
}
