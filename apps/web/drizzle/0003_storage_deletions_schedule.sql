ALTER TABLE "storage_deletions" ADD COLUMN "not_before" timestamp (3) with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "storage_deletions" ADD COLUMN "owner_id" text;--> statement-breakpoint
ALTER TABLE "storage_deletions" ADD COLUMN "asset_id" uuid;--> statement-breakpoint
ALTER TABLE "storage_deletions" ADD COLUMN "bytes" integer;--> statement-breakpoint
CREATE INDEX "storage_deletions_due_idx" ON "storage_deletions" USING btree ("not_before","created_at","id");--> statement-breakpoint
CREATE INDEX "storage_deletions_owner_idx" ON "storage_deletions" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "storage_deletions_asset_idx" ON "storage_deletions" USING btree ("asset_id");