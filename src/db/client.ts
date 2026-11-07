// Server-only Postgres access (Neon over HTTP: no connection pool to manage on serverless).
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

/** Any Drizzle Postgres database with our schema (Neon in production, PGlite in tests). */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/** The Vercel–Neon integration was connected with the STORAGE_ prefix; plain names also work. */
export function databaseUrl(env: Record<string, string | undefined> = process.env): string | undefined {
  return env.STORAGE_DATABASE_URL || env.DATABASE_URL || env.STORAGE_POSTGRES_URL || env.POSTGRES_URL || undefined;
}

let db: Db | null = null;

export function getDb(): Db | null {
  const url = databaseUrl();
  if (!url) return null;
  db ??= drizzle(neon(url), { schema }) as unknown as Db;
  return db;
}
