CREATE TABLE "user_prefs" (
	"owner" text NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "user_prefs_owner_key_pk" PRIMARY KEY("owner","key")
);
