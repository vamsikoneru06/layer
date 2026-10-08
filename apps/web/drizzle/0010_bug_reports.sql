CREATE TABLE "bug_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reporter_id" text,
	"summary" text NOT NULL,
	"expected" text DEFAULT '' NOT NULL,
	"steps" text DEFAULT '' NOT NULL,
	"page" text DEFAULT '' NOT NULL,
	"user_agent" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolved_by" text,
	"resolved_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bug_reports_status_check" CHECK ("bug_reports"."status" in ('open', 'fixed', 'dismissed'))
);
--> statement-breakpoint
ALTER TABLE "bug_reports" ADD CONSTRAINT "bug_reports_reporter_id_user_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bug_reports" ADD CONSTRAINT "bug_reports_resolved_by_user_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bug_reports_queue_idx" ON "bug_reports" USING btree ("status","created_at","id");--> statement-breakpoint
CREATE INDEX "bug_reports_reporter_idx" ON "bug_reports" USING btree ("reporter_id");