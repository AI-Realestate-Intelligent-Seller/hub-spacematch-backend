ALTER TABLE "reel_orders" ADD COLUMN "legacy_cost_credits" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "reel_orders" ADD COLUMN "delivery_note" text;