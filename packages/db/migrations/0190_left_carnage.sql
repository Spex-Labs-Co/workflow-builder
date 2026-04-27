DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'templates' AND column_name = 'visibility'
  ) THEN
    ALTER TABLE "templates" ADD COLUMN "visibility" text DEFAULT 'private' NOT NULL;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "templates_visibility_idx" ON "templates" USING btree ("visibility");--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'templates' AND constraint_name = 'templates_visibility_check'
  ) THEN
    ALTER TABLE "templates" ADD CONSTRAINT "templates_visibility_check" CHECK ("templates"."visibility" IN ('private', 'public'));
  END IF;
END $$;