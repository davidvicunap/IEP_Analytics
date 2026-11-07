import { boolean, index, integer, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

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
    // Position in the SEC list, which is ordered by market value: lower = larger company.
    rank: integer("rank"),
    // Standard Industrial Classification from the SEC "submissions" API, filled in gradually.
    sic: integer("sic"),
    sicDescription: text("sic_description"),
    sicCheckedAt: timestamp("sic_checked_at", { withTimezone: true }),
    active: boolean("active").notNull().default(true),
    source: text("source").notNull().default("SEC"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("securities_cik_idx").on(t.cik),
    index("securities_active_idx").on(t.active),
    index("securities_sic_idx").on(t.sic),
  ],
);

export type Security = typeof securities.$inferSelect;
export type NewSecurity = typeof securities.$inferInsert;

/**
 * One row per company and calendar year from SEC XBRL "frames" (every filer's value for a
 * concept in one request). Raw inputs only; ratios are computed in code so the formulas are
 * the same for a company and its peers.
 */
export const companyMetrics = pgTable(
  "company_metrics",
  {
    cik: integer("cik").notNull(),
    year: integer("year").notNull(),
    inputs: jsonb("inputs").$type<Record<string, number>>().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.cik, t.year] }), index("company_metrics_year_idx").on(t.year)],
);

export type CompanyMetrics = typeof companyMetrics.$inferSelect;
