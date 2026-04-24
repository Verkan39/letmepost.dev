ALTER TABLE "webhook_endpoints" ADD COLUMN "secret_hash" text NOT NULL;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD COLUMN "last_delivery_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD COLUMN "last_failure_reason" text;