CREATE TABLE "events" (
	"id" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"props" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "events_at_idx" ON "events" USING btree ("at");--> statement-breakpoint
CREATE INDEX "events_owner_idx" ON "events" USING btree ("owner","name");