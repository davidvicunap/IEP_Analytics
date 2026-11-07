import { boolean, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * US-listed securities from the SEC's company_tickers_exchange.json (public data).
 * Used for local ticker search and, later, to join SEC filings by CIK.
 */
export const securities = pgTable(
  "securities",
  {
    symbol: text("symbol").primaryKey(),
    cik: integer("cik").notNull(),
    name: text("name").notNull(),
    exchange: text("exchange"),
    active: boolean("active").notNull().default(true),
    source: text("source").notNull().default("SEC"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("securities_cik_idx").on(t.cik), index("securities_active_idx").on(t.active)],
);

export type Security = typeof securities.$inferSelect;
export type NewSecurity = typeof securities.$inferInsert;
