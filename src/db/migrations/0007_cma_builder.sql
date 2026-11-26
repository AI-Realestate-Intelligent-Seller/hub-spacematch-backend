CREATE TABLE "cma_comparables" (
	"id" text PRIMARY KEY NOT NULL,
	"report_id" text NOT NULL,
	"source" text NOT NULL,
	"source_record_id" text,
	"source_url" text,
	"is_fixture" boolean DEFAULT false NOT NULL,
	"manual" boolean DEFAULT false NOT NULL,
	"dedupe_key" text NOT NULL,
	"status" text NOT NULL,
	"address" text NOT NULL,
	"city" text,
	"state" text,
	"zip" text,
	"lat" double precision,
	"lng" double precision,
	"property_type" text,
	"original_list_price" double precision,
	"list_price" double precision,
	"sold_price" double precision,
	"sold_date" date,
	"list_date" date,
	"days_on_market" integer,
	"beds" double precision,
	"baths" double precision,
	"sqft" integer,
	"lot_sqft" integer,
	"year_built" integer,
	"condition" text,
	"garage_spaces" integer,
	"features" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"distance_mi" double precision,
	"image_url" text,
	"selected" boolean DEFAULT false NOT NULL,
	"adjustments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"collected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cma_comparables" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cma_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"report_id" text,
	"listing_id" text NOT NULL,
	"kind" text NOT NULL,
	"level" text DEFAULT 'info' NOT NULL,
	"stage" text,
	"provider" text,
	"message" text NOT NULL,
	"actor_email" text,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cma_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cma_market_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"listing_id" text NOT NULL,
	"report_id" text,
	"estimated_value" double precision,
	"sold_count" integer NOT NULL,
	"active_count" integer NOT NULL,
	"pending_count" integer NOT NULL,
	"median_sold_price" double precision,
	"median_ppsf" double precision,
	"avg_dom" double precision,
	"sold_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cma_market_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cma_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"listing_id" text NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"trigger" text DEFAULT 'request' NOT NULL,
	"based_on_report_id" text,
	"provider" text NOT NULL,
	"params" jsonb NOT NULL,
	"subject" jsonb NOT NULL,
	"analysis" jsonb,
	"override" jsonb,
	"content" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"stages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"progress_note" text,
	"error_message" text,
	"collect_attempts" integer DEFAULT 0 NOT NULL,
	"asking_price_cents" bigint,
	"requested_by_user_id" text,
	"requested_by_email" text NOT NULL,
	"requested_by_name" text NOT NULL,
	"reviewed_by_email" text,
	"reviewed_by_name" text,
	"data_collected_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"published_by_email" text,
	"published_by_name" text,
	"pdf_key" text,
	"pdf_rendered_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cma_reports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cma_comparables" ADD CONSTRAINT "cma_comparables_report_id_cma_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."cma_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cma_logs" ADD CONSTRAINT "cma_logs_report_id_cma_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."cma_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cma_market_snapshots" ADD CONSTRAINT "cma_market_snapshots_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cma_market_snapshots" ADD CONSTRAINT "cma_market_snapshots_report_id_cma_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."cma_reports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cma_reports" ADD CONSTRAINT "cma_reports_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cma_reports" ADD CONSTRAINT "cma_reports_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cma_comparables_report_idx" ON "cma_comparables" USING btree ("report_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cma_comparables_report_key_idx" ON "cma_comparables" USING btree ("report_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "cma_logs_report_idx" ON "cma_logs" USING btree ("report_id","created_at");--> statement-breakpoint
CREATE INDEX "cma_logs_listing_idx" ON "cma_logs" USING btree ("listing_id","created_at");--> statement-breakpoint
CREATE INDEX "cma_market_snapshots_listing_idx" ON "cma_market_snapshots" USING btree ("listing_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "cma_reports_listing_version_idx" ON "cma_reports" USING btree ("listing_id","version");--> statement-breakpoint
CREATE INDEX "cma_reports_listing_idx" ON "cma_reports" USING btree ("listing_id","created_at");--> statement-breakpoint
CREATE INDEX "cma_reports_status_idx" ON "cma_reports" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "cma_reports_one_open_idx" ON "cma_reports" USING btree ("listing_id") WHERE status in ('queued','collecting','normalizing','analyzing','ready_for_review','draft');