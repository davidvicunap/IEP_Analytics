CREATE TABLE "telegram_chats" (
	"chat_id" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"lang" text DEFAULT 'es' NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telegram_codes" (
	"code" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"lang" text DEFAULT 'es' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "telegram_chats_owner_idx" ON "telegram_chats" USING btree ("owner");