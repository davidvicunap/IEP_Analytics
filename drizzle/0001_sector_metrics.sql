CREATE TABLE "company_metrics" (
	"cik" integer NOT NULL,
	"year" integer NOT NULL,
	"inputs" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_metrics_cik_year_pk" PRIMARY KEY("cik","year")
);
--> statement-breakpoint
ALTER TABLE "securities" ADD COLUMN "rank" integer;--> statement-breakpoint
ALTER TABLE "securities" ADD COLUMN "sic" integer;--> statement-breakpoint
ALTER TABLE "securities" ADD COLUMN "sic_description" text;--> statement-breakpoint
ALTER TABLE "securities" ADD COLUMN "sic_checked_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "company_metrics_year_idx" ON "company_metrics" USING btree ("year");--> statement-breakpoint
CREATE INDEX "securities_sic_idx" ON "securities" USING btree ("sic");