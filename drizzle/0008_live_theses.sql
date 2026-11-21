CREATE TABLE "thesis_alerts" (
	"owner" text NOT NULL,
	"symbol" text NOT NULL,
	"key" text NOT NULL,
	"kind" text NOT NULL,
	"tone" text NOT NULL,
	"data" jsonb NOT NULL,
	"fired_at" timestamp with time zone NOT NULL,
	"cleared_at" timestamp with time zone,
	CONSTRAINT "thesis_alerts_owner_symbol_key_fired_at_pk" PRIMARY KEY("owner","symbol","key","fired_at")
);
--> statement-breakpoint
ALTER TABLE "research_notes" ADD COLUMN "direction" text DEFAULT 'up' NOT NULL;--> statement-breakpoint
ALTER TABLE "research_notes" ADD COLUMN "review_by" text;--> statement-breakpoint
ALTER TABLE "research_notes" ADD COLUMN "checks" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "research_notes" ADD COLUMN "opened" jsonb;--> statement-breakpoint
ALTER TABLE "research_notes" ADD COLUMN "closed" jsonb;--> statement-breakpoint
CREATE INDEX "thesis_alerts_owner_idx" ON "thesis_alerts" USING btree ("owner","symbol","fired_at");