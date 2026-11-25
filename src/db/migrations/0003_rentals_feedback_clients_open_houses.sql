CREATE TABLE "commission_buildings" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"address" text NOT NULL,
	"address_key" text NOT NULL,
	"neighborhood" text,
	"manager" text,
	"commission_pct" integer NOT NULL,
	"status" text DEFAULT 'pays' NOT NULL,
	"no_pay_reason" text,
	"bonus" text,
	"key_rule" text,
	"terms" text,
	"phone" text,
	"email" text,
	"broker_url" text,
	"website" text,
	"source_note" text,
	"source_url" text,
	"offer_ends" date,
	"verified" boolean DEFAULT false NOT NULL,
	"verified_at" timestamp with time zone,
	"verified_by_name" text,
	"verified_by_email" text,
	"verified_how" text,
	"flag_note" text,
	"flagged_by_name" text,
	"flagged_at" timestamp with time zone,
	"hidden" boolean DEFAULT false NOT NULL,
	"added_by_user_id" text,
	"added_by_email" text NOT NULL,
	"added_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "commission_buildings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" text PRIMARY KEY NOT NULL,
	"from_user_id" text,
	"from_email" text NOT NULL,
	"from_name" text NOT NULL,
	"kind" text NOT NULL,
	"area" text NOT NULL,
	"title" text NOT NULL,
	"details" text DEFAULT '' NOT NULL,
	"blocking" boolean,
	"shot_key" text,
	"category" text NOT NULL,
	"category_source" text DEFAULT 'auto' NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"priority" text,
	"estimate" text,
	"review_note" text,
	"merged_into" text,
	"reviewed_at" timestamp with time zone,
	"decision_note" text,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"shipped_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "feedback" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "feedback_votes" (
	"feedback_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_votes_feedback_id_user_id_pk" PRIMARY KEY("feedback_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "feedback_votes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "open_houses" (
	"id" text PRIMARY KEY NOT NULL,
	"listing_id" text,
	"address" text NOT NULL,
	"date" date NOT NULL,
	"start" text NOT NULL,
	"end" text NOT NULL,
	"listing_agent" text NOT NULL,
	"host_email" text,
	"host_name" text,
	"notes" text,
	"created_by_email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "open_houses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "past_clients" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_user_id" text,
	"agent_email" text NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"email" text,
	"address" text,
	"closed_on" date NOT NULL,
	"side" text NOT NULL,
	"done" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "past_clients" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commission_buildings" ADD CONSTRAINT "commission_buildings_added_by_user_id_users_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_from_user_id_users_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_votes" ADD CONSTRAINT "feedback_votes_feedback_id_feedback_id_fk" FOREIGN KEY ("feedback_id") REFERENCES "public"."feedback"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_votes" ADD CONSTRAINT "feedback_votes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "open_houses" ADD CONSTRAINT "open_houses_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "past_clients" ADD CONSTRAINT "past_clients_agent_user_id_users_id_fk" FOREIGN KEY ("agent_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commission_buildings_key_idx" ON "commission_buildings" USING btree ("address_key");--> statement-breakpoint
CREATE INDEX "feedback_status_idx" ON "feedback" USING btree ("status");--> statement-breakpoint
CREATE INDEX "feedback_from_idx" ON "feedback" USING btree ("from_email");--> statement-breakpoint
CREATE INDEX "open_houses_date_idx" ON "open_houses" USING btree ("date");--> statement-breakpoint
CREATE INDEX "past_clients_agent_idx" ON "past_clients" USING btree ("agent_email");