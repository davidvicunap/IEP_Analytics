CREATE TABLE "research_notes" (
	"owner" text NOT NULL,
	"symbol" text NOT NULL,
	"thesis" text DEFAULT '' NOT NULL,
	"bull" text DEFAULT '' NOT NULL,
	"bear" text DEFAULT '' NOT NULL,
	"fair_value" double precision,
	"entry" double precision,
	"stop" double precision,
	"target" double precision,
	"log" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "research_notes_owner_symbol_pk" PRIMARY KEY("owner","symbol")
);
--> statement-breakpoint
CREATE INDEX "research_notes_owner_idx" ON "research_notes" USING btree ("owner","updated_at");