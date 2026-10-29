-- Templates are filed by job instead of topic (document schemaVersion 2; the same mapping as V1_CATEGORIES in
-- packages/schema/src/migrate.ts). Stored documents stay at version 1 and are migrated when read; these columns are
-- what the gallery filters on and what onboarding saved.
UPDATE "templates" SET "category" = CASE "category" WHEN 'birthday' THEN 'celebrations' WHEN 'business' THEN 'announcements' WHEN 'food' THEN 'menus' WHEN 'travel' THEN 'photo-posts' WHEN 'quotes' THEN 'quotes-tips' WHEN 'events' THEN 'events' WHEN 'sale' THEN 'sales' WHEN 'minimal' THEN 'photo-posts' ELSE "category" END
WHERE "category" IN ('birthday', 'business', 'food', 'travel', 'quotes', 'events', 'sale', 'minimal');
--> statement-breakpoint
UPDATE "user" SET "interests" = ARRAY(
  SELECT DISTINCT CASE i WHEN 'birthday' THEN 'celebrations' WHEN 'business' THEN 'announcements' WHEN 'food' THEN 'menus' WHEN 'travel' THEN 'photo-posts' WHEN 'quotes' THEN 'quotes-tips' WHEN 'events' THEN 'events' WHEN 'sale' THEN 'sales' WHEN 'minimal' THEN 'photo-posts' ELSE i END FROM unnest("interests") AS i
)
WHERE cardinality("interests") > 0;
