ALTER TABLE "templates"
ADD COLUMN IF NOT EXISTS "visibility" text NOT NULL DEFAULT 'private';

ALTER TABLE "templates"
DROP CONSTRAINT IF EXISTS "templates_visibility_check";

ALTER TABLE "templates"
ADD CONSTRAINT "templates_visibility_check"
CHECK ("templates"."visibility" IN ('private', 'public'));

CREATE INDEX IF NOT EXISTS "templates_visibility_idx" ON "templates" USING btree ("visibility");
