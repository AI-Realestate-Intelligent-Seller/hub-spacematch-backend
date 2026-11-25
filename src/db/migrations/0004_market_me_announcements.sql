CREATE TABLE "announcements" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text,
	"body" text NOT NULL,
	"link" text,
	"pinned" boolean DEFAULT false NOT NULL,
	"author_email" text NOT NULL,
	"author_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "announcements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_email" text NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "push_subscriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "agent_marketing" (
	"email" text PRIMARY KEY NOT NULL,
	"review_url" text,
	"areas" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_marketing" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "market_stats" (
	"id" text PRIMARY KEY NOT NULL,
	"area" text NOT NULL,
	"month" text NOT NULL,
	"sales" integer,
	"median" integer,
	"yoy_pct" real,
	"dom_median" integer,
	"sold_to_list" real,
	"active" integer,
	"months_supply" real,
	"source" text NOT NULL,
	"entered_by" text,
	"pulled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "market_stats" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "review_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"agent_email" text NOT NULL,
	"agent_name" text NOT NULL,
	"client_name" text NOT NULL,
	"channel" text NOT NULL,
	"target" text NOT NULL,
	"opens" integer DEFAULT 0 NOT NULL,
	"first_opened_at" timestamp with time zone,
	"clicked_at" timestamp with time zone,
	"note" text,
	"note_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "review_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "announcements_created_idx" ON "announcements" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "push_subscriptions_endpoint_idx" ON "push_subscriptions" USING btree ("endpoint");--> statement-breakpoint
CREATE INDEX "market_stats_area_month_idx" ON "market_stats" USING btree ("area","month");--> statement-breakpoint
CREATE UNIQUE INDEX "review_requests_token_idx" ON "review_requests" USING btree ("token");--> statement-breakpoint
CREATE INDEX "review_requests_agent_idx" ON "review_requests" USING btree ("agent_email","created_at");