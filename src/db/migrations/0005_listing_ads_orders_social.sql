CREATE TABLE "ad_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"listing_id" text,
	"address" text NOT NULL,
	"agent_email" text NOT NULL,
	"agent_name" text NOT NULL,
	"tier" text NOT NULL,
	"open_house" boolean DEFAULT false NOT NULL,
	"payment" text NOT NULL,
	"spend" integer NOT NULL,
	"fee" integer NOT NULL,
	"surcharge" integer NOT NULL,
	"total" integer NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"payment_status" text DEFAULT 'unpaid' NOT NULL,
	"payment_note" text,
	"authorized_at" timestamp with time zone NOT NULL,
	"ordered_by_email" text NOT NULL,
	"note" text,
	"admin_note" text,
	"decided_by_email" text,
	"decided_at" timestamp with time zone,
	"live_at" timestamp with time zone,
	"settled_at" timestamp with time zone,
	"kit" jsonb,
	"meta_campaign_id" text,
	"draft_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ad_orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "listing_ads" (
	"id" text PRIMARY KEY NOT NULL,
	"listing_id" text NOT NULL,
	"channel" text NOT NULL,
	"status" text DEFAULT 'not_started' NOT NULL,
	"start_date" text,
	"end_date" text,
	"reach" double precision,
	"views" double precision,
	"clicks" double precision,
	"leads" double precision,
	"spend" double precision,
	"budget" double precision,
	"campaign_ref" text,
	"ad_link" text,
	"note" text,
	"pages" text,
	"campaigns" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"error" text,
	"requested_at" timestamp with time zone,
	"updated_by_email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "listing_ads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "listing_reel_stats" (
	"id" text PRIMARY KEY NOT NULL,
	"listing_id" text NOT NULL,
	"link_id" text NOT NULL,
	"platform" text NOT NULL,
	"url" text NOT NULL,
	"embed_url" text,
	"views" integer,
	"likes" integer,
	"comments" integer,
	"shares" integer,
	"ok_at" timestamp with time zone,
	"checked_at" timestamp with time zone,
	"error_code" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "listing_reel_stats" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "listing_social" (
	"listing_id" text PRIMARY KEY NOT NULL,
	"reels_property_id" text,
	"last_synced_at" timestamp with time zone,
	"last_refresh_status" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "listing_social" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ad_orders" ADD CONSTRAINT "ad_orders_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_ads" ADD CONSTRAINT "listing_ads_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_reel_stats" ADD CONSTRAINT "listing_reel_stats_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_social" ADD CONSTRAINT "listing_social_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ad_orders_listing_idx" ON "ad_orders" USING btree ("listing_id");--> statement-breakpoint
CREATE INDEX "ad_orders_agent_idx" ON "ad_orders" USING btree ("agent_email");--> statement-breakpoint
CREATE INDEX "ad_orders_status_idx" ON "ad_orders" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "listing_ads_listing_channel_idx" ON "listing_ads" USING btree ("listing_id","channel");--> statement-breakpoint
CREATE INDEX "listing_ads_listing_idx" ON "listing_ads" USING btree ("listing_id");--> statement-breakpoint
CREATE INDEX "listing_reel_stats_listing_idx" ON "listing_reel_stats" USING btree ("listing_id");