CREATE TABLE "insider_checks" (
	"issuer_cik" integer PRIMARY KEY NOT NULL,
	"checked_at" timestamp with time zone NOT NULL,
	"pending" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "insider_filings" (
	"accn" text PRIMARY KEY NOT NULL,
	"issuer_cik" integer NOT NULL,
	"filed" text NOT NULL,
	"status" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "insider_transactions" (
	"accn" text NOT NULL,
	"seq" integer NOT NULL,
	"issuer_cik" integer NOT NULL,
	"owner_cik" integer,
	"owner_name" text NOT NULL,
	"other_owners" integer DEFAULT 0 NOT NULL,
	"is_director" boolean NOT NULL,
	"is_officer" boolean NOT NULL,
	"is_ten_pct" boolean NOT NULL,
	"officer_title" text,
	"date" text NOT NULL,
	"code" text NOT NULL,
	"acquired" boolean NOT NULL,
	"shares" double precision NOT NULL,
	"price" double precision,
	"owned_after" double precision,
	"direct" boolean NOT NULL,
	"planned" boolean NOT NULL,
	"security" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "insider_filings_issuer_idx" ON "insider_filings" USING btree ("issuer_cik");--> statement-breakpoint
CREATE UNIQUE INDEX "insider_tx_accn_seq_idx" ON "insider_transactions" USING btree ("accn","seq");--> statement-breakpoint
CREATE INDEX "insider_tx_issuer_date_idx" ON "insider_transactions" USING btree ("issuer_cik","date");