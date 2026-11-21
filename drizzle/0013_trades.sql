CREATE TABLE "trades" (
	"id" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"symbol" text NOT NULL,
	"side" text NOT NULL,
	"date" text NOT NULL,
	"shares" double precision NOT NULL,
	"price" double precision NOT NULL,
	"fees" double precision DEFAULT 0 NOT NULL,
	"stop" double precision,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "trades_owner_idx" ON "trades" USING btree ("owner","symbol","date");