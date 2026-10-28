CREATE TABLE "brand_kits" (
	"user_id" text PRIMARY KEY NOT NULL,
	"colors" text[] DEFAULT '{}'::text[] NOT NULL,
	"fonts" text[] DEFAULT '{}'::text[] NOT NULL,
	"logo_asset_id" uuid,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "brand_kits" ADD CONSTRAINT "brand_kits_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_kits" ADD CONSTRAINT "brand_kits_logo_asset_id_assets_id_fk" FOREIGN KEY ("logo_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Row-level security like the other owner tables (0007): a user's requests see and change only their own kit.
ALTER TABLE "brand_kits" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "brand_kits_owner" ON "brand_kits" TO vash_app
  USING ("user_id" = current_setting('vash.user_id', true))
  WITH CHECK ("user_id" = current_setting('vash.user_id', true));
