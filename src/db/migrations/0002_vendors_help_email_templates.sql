CREATE TABLE "email_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text,
	"owner_email" text NOT NULL,
	"owner_name" text NOT NULL,
	"title" text NOT NULL,
	"segment" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'mine' NOT NULL,
	"review_note" text,
	"reviewed_by" text,
	"based_on" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "help_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"from_user_id" text,
	"from_email" text NOT NULL,
	"from_name" text NOT NULL,
	"to_name" text NOT NULL,
	"to_email" text NOT NULL,
	"topic" text NOT NULL,
	"details" text DEFAULT '' NOT NULL,
	"urgency" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"reply" text,
	"status_at" timestamp with time zone,
	"status_by" text,
	"reassigned_by" text,
	"done_at" timestamp with time zone,
	"done_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "help_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "vendor_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"vendor_id" text NOT NULL,
	"user_email" text NOT NULL,
	"user_name" text NOT NULL,
	"rating" integer NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vendor_reviews" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "vendors" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"company" text,
	"category" text NOT NULL,
	"subcategory" text,
	"description" text,
	"phone" text,
	"email" text,
	"website" text,
	"address" text,
	"areas" text,
	"languages" text,
	"perk" text,
	"preferred" boolean DEFAULT false NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"private" boolean DEFAULT false NOT NULL,
	"on_website" boolean DEFAULT true NOT NULL,
	"added_by_user_id" text,
	"added_by_email" text NOT NULL,
	"added_by_name" text NOT NULL,
	"source" text DEFAULT 'agent' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vendors" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "help_requests" ADD CONSTRAINT "help_requests_from_user_id_users_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_reviews" ADD CONSTRAINT "vendor_reviews_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_added_by_user_id_users_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_templates_owner_idx" ON "email_templates" USING btree ("owner_email","updated_at");--> statement-breakpoint
CREATE INDEX "email_templates_status_idx" ON "email_templates" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "help_requests_from_idx" ON "help_requests" USING btree ("from_email","created_at");--> statement-breakpoint
CREATE INDEX "help_requests_to_idx" ON "help_requests" USING btree ("to_email","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "vendor_reviews_vendor_user_idx" ON "vendor_reviews" USING btree ("vendor_id","user_email");--> statement-breakpoint
CREATE INDEX "vendors_category_idx" ON "vendors" USING btree ("category");--> statement-breakpoint
CREATE INDEX "vendors_added_by_idx" ON "vendors" USING btree ("added_by_email");