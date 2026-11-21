CREATE TABLE "splits" (
	"symbol" text NOT NULL,
	"date" text NOT NULL,
	"ratio" double precision NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "splits_symbol_date_pk" PRIMARY KEY("symbol","date")
);
