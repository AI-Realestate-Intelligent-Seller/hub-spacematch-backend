CREATE TABLE "reel_assets" (
	"id" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size" integer NOT NULL,
	"parts" integer NOT NULL,
	"ready" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reel_assets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "reel_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"agent_name" text NOT NULL,
	"tier" text NOT NULL,
	"price" integer NOT NULL,
	"free" integer NOT NULL,
	"status" text NOT NULL,
	"options" jsonb NOT NULL,
	"clips" jsonb NOT NULL,
	"notes" text,
	"payments" jsonb NOT NULL,
	"revisions" jsonb NOT NULL,
	"outputs" jsonb NOT NULL,
	"caption_lines" jsonb NOT NULL,
	"timeline" jsonb,
	"version" integer DEFAULT 0 NOT NULL,
	"generation" integer DEFAULT 0 NOT NULL,
	"stage" text,
	"status_note" text,
	"question" text,
	"answer" text,
	"queued_at" timestamp with time zone,
	"picked_up_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reel_orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "reel_assets_owner_idx" ON "reel_assets" USING btree ("owner");--> statement-breakpoint
CREATE INDEX "reel_orders_owner_idx" ON "reel_orders" USING btree ("owner");--> statement-breakpoint
CREATE INDEX "reel_orders_status_idx" ON "reel_orders" USING btree ("status");