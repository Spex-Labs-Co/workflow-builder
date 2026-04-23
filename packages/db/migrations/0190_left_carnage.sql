ALTER TABLE "templates" ADD COLUMN "visibility" text DEFAULT 'private' NOT NULL;--> statement-breakpoint
CREATE INDEX "templates_visibility_idx" ON "templates" USING btree ("visibility");--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_visibility_check" CHECK ("templates"."visibility" IN ('private', 'public'));