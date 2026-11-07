CREATE TABLE "securities" (
	"symbol" text PRIMARY KEY NOT NULL,
	"cik" integer NOT NULL,
	"name" text NOT NULL,
	"exchange" text,
	"active" boolean DEFAULT true NOT NULL,
	"source" text DEFAULT 'SEC' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "securities_cik_idx" ON "securities" USING btree ("cik");--> statement-breakpoint
CREATE INDEX "securities_active_idx" ON "securities" USING btree ("active");