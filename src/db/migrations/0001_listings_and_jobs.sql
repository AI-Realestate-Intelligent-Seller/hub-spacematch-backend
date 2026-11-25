CREATE TABLE "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "listing_events" (
	"id" text PRIMARY KEY NOT NULL,
	"listing_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"interest" text,
	"price_opinion" text,
	"rating" text,
	"when" text,
	"agent_only" text,
	"source" text NOT NULL,
	"external_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "listing_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "listing_metrics" (
	"id" text PRIMARY KEY NOT NULL,
	"listing_id" text NOT NULL,
	"week_of" date NOT NULL,
	"zillow_views" integer,
	"zillow_saves" integer,
	"mls_saved" integer,
	"mls_maybe" integer,
	"mls_not_interested" integer,
	"ad_views" integer,
	"ad_clicks" integer,
	"reel_views" integer,
	"tiktok_views" integer,
	"fb_views" integer,
	"youtube_views" integer,
	"auto" text[] DEFAULT '{}' NOT NULL,
	"zillow_days" integer,
	"entered_by_email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "listing_metrics" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "listing_suggestions" (
	"id" text PRIMARY KEY NOT NULL,
	"listing_id" text NOT NULL,
	"rule_key" text NOT NULL,
	"title" text NOT NULL,
	"why" text NOT NULL,
	"action" text NOT NULL,
	"status" text NOT NULL,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "listing_suggestions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "listings" (
	"id" text PRIMARY KEY NOT NULL,
	"address" text NOT NULL,
	"address_key" text NOT NULL,
	"mls_number" text,
	"price_cents" bigint,
	"status" text DEFAULT 'Preparing' NOT NULL,
	"photo_url" text,
	"agent_user_id" text,
	"agent_email" text NOT NULL,
	"agent_name" text NOT NULL,
	"seller_name" text NOT NULL,
	"seller_email" text,
	"seller_phone" text,
	"token" text NOT NULL,
	"steps" jsonb NOT NULL,
	"links" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"live_date" date,
	"zillow_page" jsonb,
	"lofty_lead_id" text,
	"lofty_error" text,
	"lofty_at" timestamp with time zone,
	"reel_auto" jsonb,
	"yt_auto" jsonb,
	"weekly_email" boolean DEFAULT false NOT NULL,
	"seller_last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "listings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "showing_inbox" (
	"id" text PRIMARY KEY NOT NULL,
	"external_id" text NOT NULL,
	"subject" text NOT NULL,
	"address" text NOT NULL,
	"mls" text,
	"parsed" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "showing_inbox" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "listing_events" ADD CONSTRAINT "listing_events_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_metrics" ADD CONSTRAINT "listing_metrics_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_suggestions" ADD CONSTRAINT "listing_suggestions_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_agent_user_id_users_id_fk" FOREIGN KEY ("agent_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "jobs_status_run_at_idx" ON "jobs" USING btree ("status","run_at");--> statement-breakpoint
CREATE INDEX "jobs_kind_idx" ON "jobs" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "listing_events_listing_idx" ON "listing_events" USING btree ("listing_id","created_at");--> statement-breakpoint
CREATE INDEX "listing_events_external_idx" ON "listing_events" USING btree ("external_id");--> statement-breakpoint
CREATE INDEX "listing_events_status_idx" ON "listing_events" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "listing_metrics_listing_week_idx" ON "listing_metrics" USING btree ("listing_id","week_of");--> statement-breakpoint
CREATE INDEX "listing_suggestions_listing_idx" ON "listing_suggestions" USING btree ("listing_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "listings_token_idx" ON "listings" USING btree ("token");--> statement-breakpoint
CREATE INDEX "listings_agent_email_idx" ON "listings" USING btree ("agent_email");--> statement-breakpoint
CREATE INDEX "listings_mls_idx" ON "listings" USING btree ("mls_number");--> statement-breakpoint
CREATE INDEX "listings_address_key_idx" ON "listings" USING btree ("address_key");--> statement-breakpoint
CREATE UNIQUE INDEX "showing_inbox_external_idx" ON "showing_inbox" USING btree ("external_id");