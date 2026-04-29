CREATE TABLE "spex_identity_link" (
	"spex_user_id" text PRIMARY KEY NOT NULL,
	"sim_user_id" text NOT NULL,
	"default_workspace_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "spex_identity_link_sim_user_id_unique" UNIQUE("sim_user_id")
);
--> statement-breakpoint
ALTER TABLE "spex_identity_link" ADD CONSTRAINT "spex_identity_link_sim_user_id_user_id_fk" FOREIGN KEY ("sim_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spex_identity_link" ADD CONSTRAINT "spex_identity_link_default_workspace_id_workspace_id_fk" FOREIGN KEY ("default_workspace_id") REFERENCES "public"."workspace"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "spex_identity_link_sim_user_id_idx" ON "spex_identity_link" USING btree ("sim_user_id");