CREATE TABLE "livekit_settings" (
	"user_id" text PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"api_key" text NOT NULL,
	"secret_enc" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "livekit_settings" ADD CONSTRAINT "livekit_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;