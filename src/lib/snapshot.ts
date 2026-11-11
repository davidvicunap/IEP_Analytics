// Server-side: the watchlist dashboard's summary of one stock, from public SEC data only (no
// FMP quota): long-term quality, latest filings and 12 months of insider trades.
import { getDb } from "@/db/client";
import { getFilings } from "./filings";
import { buildInsiders } from "./insiders";
import { getQuality } from "./qualityData";
import { getSecurity } from "./securities";
import { pickFilings, type Part, type SnapshotPayload } from "./snapshotShared";
import type { DataIssue, Result } from "./types";

// A dashboard row reads at most this long of new Form 4 filings per request; the rest is read on
// later visits (the row says the figure is partial meanwhile).
const INSIDER_BUDGET_MS = 3_000;

const fail = <T,>(error: DataIssue): Part<T> => ({ ok: false, error });

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
  const { cik } = security;

  const [quality, filings, insiders] = await Promise.all([
    getQuality(security.symbol).then((r): SnapshotPayload["quality"] =>
      r.ok ? { ok: true, data: { ...r.data.summary, fiscal: r.data.lastFiscal?.label ?? null } } : fail(r.error),
    ),
    getFilings(security.symbol).then((r): SnapshotPayload["filings"] => (r.ok ? { ok: true, data: pickFilings(r.data.filings) } : fail(r.error))),
    buildInsiders(db, security.symbol, cik, { budgetMs: INSIDER_BUDGET_MS })
      .then((r): SnapshotPayload["insiders"] => {
        if (!r.ok) return fail(r.error);
        const s = r.data.summary;
        return {
          ok: true,
          data: {
            from: s.from,
            to: s.to,
            bought: s.purchases.value,
            sold: s.sales.value,
            buyers: s.purchases.insiders,
            sellers: s.sales.insiders,
            pending: r.data.pending,
            checkedAt: r.data.checkedAt,
          },
        };
      })
      .catch(() => fail<never>("upstream")),
  ]);
  return { ok: true, data: { symbol: security.symbol, cik, quality, filings, insiders }, fetchedAt: new Date().toISOString() };
}
