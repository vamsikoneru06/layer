-- Row-level security behind the owner filter every repository query already has (src/server/db/user-scope.ts).
-- Requests for a signed-in user run as vash_app with vash.user_id set; everything else (auth, cron, public pages)
-- runs as the connecting role, which owns the tables and is not subject to these policies.
-- No user id set means no rows: current_setting(..., true) is NULL and NULL never equals an owner.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'vash_app') THEN
    CREATE ROLE vash_app NOLOGIN;
  END IF;
END
$$;
--> statement-breakpoint
-- The app's own login switches to vash_app with SET LOCAL ROLE, so it must be a member.
GRANT vash_app TO CURRENT_USER;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO vash_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO vash_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO vash_app;
--> statement-breakpoint
-- Tables added by later migrations get the same grants.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO vash_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO vash_app;
--> statement-breakpoint
ALTER TABLE "designs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "designs_owner" ON "designs" TO vash_app
  USING ("owner_id" = current_setting('vash.user_id', true))
  WITH CHECK ("owner_id" = current_setting('vash.user_id', true));
--> statement-breakpoint
ALTER TABLE "folders" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "folders_owner" ON "folders" TO vash_app
  USING ("owner_id" = current_setting('vash.user_id', true))
  WITH CHECK ("owner_id" = current_setting('vash.user_id', true));
--> statement-breakpoint
ALTER TABLE "share_links" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- A share link belongs to whoever owns its design.
CREATE POLICY "share_links_design_owner" ON "share_links" TO vash_app
  USING (EXISTS (SELECT 1 FROM "designs" d WHERE d."id" = "share_links"."design_id" AND d."owner_id" = current_setting('vash.user_id', true)))
  WITH CHECK (
    "created_by" = current_setting('vash.user_id', true)
    AND EXISTS (SELECT 1 FROM "designs" d WHERE d."id" = "share_links"."design_id" AND d."owner_id" = current_setting('vash.user_id', true))
  );
--> statement-breakpoint
ALTER TABLE "assets" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Your own photos, plus system-owned ones (samples, template copies) and anything public.
CREATE POLICY "assets_read" ON "assets" FOR SELECT TO vash_app
  USING ("owner_id" = current_setting('vash.user_id', true) OR "owner_id" IS NULL OR "visibility" = 'public');
--> statement-breakpoint
-- Your own uploads, or system-owned copies made for a template you author (publishing).
CREATE POLICY "assets_insert" ON "assets" FOR INSERT TO vash_app
  WITH CHECK (
    "owner_id" = current_setting('vash.user_id', true)
    OR ("owner_id" IS NULL AND "template_id" IN (SELECT t."id" FROM "templates" t WHERE t."author_id" = current_setting('vash.user_id', true)))
  );
--> statement-breakpoint
CREATE POLICY "assets_update" ON "assets" FOR UPDATE TO vash_app
  USING ("owner_id" = current_setting('vash.user_id', true))
  WITH CHECK ("owner_id" = current_setting('vash.user_id', true));
--> statement-breakpoint
CREATE POLICY "assets_delete" ON "assets" FOR DELETE TO vash_app
  USING ("owner_id" = current_setting('vash.user_id', true));
