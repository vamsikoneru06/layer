CREATE TABLE "design_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"design_id" uuid NOT NULL,
	"owner_id" text NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"doc" jsonb NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "design_versions" ADD CONSTRAINT "design_versions_design_id_designs_id_fk" FOREIGN KEY ("design_id") REFERENCES "public"."designs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_versions" ADD CONSTRAINT "design_versions_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "design_versions_design_idx" ON "design_versions" USING btree ("design_id","created_at" DESC NULLS LAST);--> statement-breakpoint
-- Grants as 0007 gives every table (ALTER DEFAULT PRIVILEGES covers it too; this states it for this table).
GRANT SELECT, INSERT, UPDATE, DELETE ON "design_versions" TO vash_app;
--> statement-breakpoint
ALTER TABLE "design_versions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- A version belongs to whoever owns its design; the owner is the only one who can keep or read one.
CREATE POLICY "design_versions_owner" ON "design_versions" TO vash_app
  USING ("owner_id" = current_setting('vash.user_id', true))
  WITH CHECK (
    "owner_id" = current_setting('vash.user_id', true)
    AND EXISTS (SELECT 1 FROM "designs" d WHERE d."id" = "design_versions"."design_id" AND d."owner_id" = current_setting('vash.user_id', true))
  );
