CREATE TABLE "form_submissions" (
	"id" text PRIMARY KEY NOT NULL,
	"form_id" text NOT NULL,
	"listing_id" text,
	"agent_email" text,
	"agent_name" text,
	"audience" text NOT NULL,
	"contact_name" text NOT NULL,
	"contact_email" text,
	"contact_phone" text,
	"property_address" text,
	"answers" jsonb NOT NULL,
	"is_lead" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "form_submissions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "form_submissions_listing_form_idx" ON "form_submissions" USING btree ("listing_id","form_id","created_at");--> statement-breakpoint
CREATE INDEX "form_submissions_agent_created_idx" ON "form_submissions" USING btree ("agent_email","created_at");