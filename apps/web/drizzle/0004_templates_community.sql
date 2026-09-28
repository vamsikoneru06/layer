ALTER TABLE "assets" ADD COLUMN "template_id" uuid;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "source_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assets_template_idx" ON "assets" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "templates_popular_idx" ON "templates" USING btree ("status","uses_count","id");--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_template_copy_check" CHECK ("assets"."template_id" is null or ("assets"."owner_id" is null and "assets"."visibility" = 'public'));