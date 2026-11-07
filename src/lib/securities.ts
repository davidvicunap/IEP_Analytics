// Securities master: refresh from the SEC and search locally (no FMP quota used).
import { and, count, eq, ilike, lt, max, or, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { securities, type NewSecurity } from "@/db/schema";
import type { SearchResult } from "./types";

const CHUNK = 500;

/** Escapes LIKE wildcards so user input is matched literally. */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export interface RefreshResult {
  upserted: number;
  deactivated: number;
}

/** Upserts the latest SEC list and marks symbols that disappeared from it as inactive. */
export async function refreshSecurities(db: Db, rows: Omit<NewSecurity, "updatedAt">[]): Promise<RefreshResult> {
  if (rows.length === 0) throw new Error("securities: refusing to refresh from an empty list");
  const startedAt = new Date();
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK).map((r) => ({ ...r, active: true, updatedAt: startedAt }));
    await db
      .insert(securities)
      .values(chunk)
      .onConflictDoUpdate({
        target: securities.symbol,
        set: {
          cik: sql`excluded.cik`,
          name: sql`excluded.name`,
          exchange: sql`excluded.exchange`,
          active: sql`excluded.active`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  }
  const gone = await db
    .update(securities)
    .set({ active: false })
    .where(and(eq(securities.active, true), lt(securities.updatedAt, startedAt)))
    .returning({ symbol: securities.symbol });
  return { upserted: rows.length, deactivated: gone.length };
}

export async function securitiesStatus(db: Db): Promise<{ active: number; updatedAt: Date | null }> {
  const [row] = await db
    .select({ active: count(), updatedAt: max(securities.updatedAt) })
    .from(securities)
    .where(eq(securities.active, true));
  return { active: Number(row?.active ?? 0), updatedAt: row?.updatedAt ?? null };
}

/** Exact symbol first, then symbol prefix, then name matches; shorter symbols first. */
export async function searchSecurities(db: Db, query: string, limit = 10): Promise<SearchResult[]> {
  const q = query.trim().slice(0, 40);
  if (!q) return [];
  const upper = q.toUpperCase();
  const prefix = `${escapeLike(upper)}%`;
  const rows = await db
    .select({ symbol: securities.symbol, name: securities.name, exchange: securities.exchange })
    .from(securities)
    .where(
      and(
        eq(securities.active, true),
        or(ilike(securities.symbol, prefix), ilike(securities.name, `%${escapeLike(q)}%`)),
      ),
    )
    .orderBy(
      sql`case when ${securities.symbol} = ${upper} then 0 when ${securities.symbol} like ${prefix} then 1 else 2 end`,
      sql`length(${securities.symbol})`,
      securities.symbol,
    )
    .limit(limit);
  return rows.map((r) => ({ symbol: r.symbol, name: r.name, exchange: r.exchange ?? undefined }));
}
