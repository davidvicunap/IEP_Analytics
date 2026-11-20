CREATE TABLE "explanations" (
	"symbol" text NOT NULL,
	"lang" text NOT NULL,
	"facts_hash" text NOT NULL,
	"body" jsonb NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "explanations_symbol_lang_facts_hash_pk" PRIMARY KEY("symbol","lang","facts_hash")
);
