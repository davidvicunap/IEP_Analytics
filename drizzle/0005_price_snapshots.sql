CREATE TABLE "price_snapshots" (
	"symbol" text PRIMARY KEY NOT NULL,
	"quote" jsonb NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL
);
