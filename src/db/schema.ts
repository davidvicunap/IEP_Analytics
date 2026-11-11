import { boolean, doublePrecision, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

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

/** Form 4 filings already read for an issuer (also failures, so they aren't retried daily). */
export const insiderFilings = pgTable(
  "insider_filings",
  {
    accn: text("accn").primaryKey(),
    issuerCik: integer("issuer_cik").notNull(),
    filed: text("filed").notNull(), // YYYY-MM-DD
    status: text("status").notNull(), // "ok" | "error"
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("insider_filings_issuer_idx").on(t.issuerCik)],
);

/** Non-derivative transactions from Form 4 filings, one row per transaction. */
export const insiderTransactions = pgTable(
  "insider_transactions",
  {
    accn: text("accn").notNull(),
    seq: integer("seq").notNull(),
    issuerCik: integer("issuer_cik").notNull(),
    ownerCik: integer("owner_cik"),
    ownerName: text("owner_name").notNull(),
    otherOwners: integer("other_owners").notNull().default(0),
    isDirector: boolean("is_director").notNull(),
    isOfficer: boolean("is_officer").notNull(),
    isTenPct: boolean("is_ten_pct").notNull(),
    officerTitle: text("officer_title"),
    date: text("date").notNull(),
    code: text("code").notNull(),
    acquired: boolean("acquired").notNull(),
    shares: doublePrecision("shares").notNull(),
    price: doublePrecision("price"),
    ownedAfter: doublePrecision("owned_after"),
    direct: boolean("direct").notNull(),
    planned: boolean("planned").notNull(),
    security: text("security").notNull(),
  },
  (t) => [uniqueIndex("insider_tx_accn_seq_idx").on(t.accn, t.seq), index("insider_tx_issuer_date_idx").on(t.issuerCik, t.date)],
);

/** When each issuer's Form 4 list was last checked, and how many filings are still unread. */
export const insiderChecks = pgTable("insider_checks", {
  issuerCik: integer("issuer_cik").primaryKey(),
  checkedAt: timestamp("checked_at", { withTimezone: true }).notNull(),
  pending: integer("pending").notNull().default(0),
});

/**
 * The last good quote we got for each symbol (FMP's own fields, as served to the page).
 * Shown, clearly labelled with its time, when FMP can't answer: quota used up, not in the
 * plan for now, or down.
 */
export const priceSnapshots = pgTable("price_snapshots", {
  symbol: text("symbol").primaryKey(),
  quote: jsonb("quote").notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
});

/**
 * One research notebook per user and stock. `owner` is the beta invite's label (each invited
 * person has their own); fields mirror lib/research.ts, the log is a JSON array, newest first.
 */
export const researchNotes = pgTable(
  "research_notes",
  {
    owner: text("owner").notNull(),
    symbol: text("symbol").notNull(),
    thesis: text("thesis").notNull().default(""),
    bull: text("bull").notNull().default(""),
    bear: text("bear").notNull().default(""),
    fairValue: doublePrecision("fair_value"),
    entry: doublePrecision("entry"),
    stop: doublePrecision("stop"),
    target: doublePrecision("target"),
    log: jsonb("log").notNull().default([]),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.owner, t.symbol] }), index("research_notes_owner_idx").on(t.owner, t.updatedAt)],
);
