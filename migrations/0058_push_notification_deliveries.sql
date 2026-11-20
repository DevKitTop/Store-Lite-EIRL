-- =====================================================
-- 0058 - Push notification deliveries (PWA P2, T2.5)
-- =====================================================
-- Durable outbox for Web Push fan-out. Rows are created only after the source
-- notification is durable. Delivery is server-only: RLS is enabled with no
-- client policies, and a privileged server worker claims/updates rows.
--
-- ADDITIVE and IDEMPOTENT:
--   - no DROP TABLE, no DROP COLUMN, no DELETE, no data rewrites
--   - one unique fan-out key per notification, recipient and device
-- =====================================================

CREATE TABLE IF NOT EXISTS "public"."push_notification_deliveries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "notification_id" uuid NOT NULL REFERENCES "public"."notifications"("id") ON DELETE CASCADE,
  "recipient_user_id" uuid NOT NULL REFERENCES "public"."profiles"("id") ON DELETE CASCADE,
  "push_subscription_id" uuid NOT NULL REFERENCES "public"."push_subscriptions"("id") ON DELETE CASCADE,
  "status" text DEFAULT 'pending' NOT NULL CHECK ("status" IN ('pending', 'processing', 'delivered', 'retryable_failed', 'terminal_failed', 'invalidated', 'skipped')),
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_attempt_at" timestamp with time zone,
  "lease_expires_at" timestamp with time zone,
  "provider_status_code" integer,
  "last_error_class" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "push_notification_deliveries_unique" UNIQUE ("notification_id", "recipient_user_id", "push_subscription_id")
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_push_deliveries_ready" ON "public"."push_notification_deliveries" USING btree ("status", "next_attempt_at") WHERE "status" IN ('pending', 'retryable_failed');
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_push_deliveries_notification" ON "public"."push_notification_deliveries" USING btree ("notification_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_push_deliveries_subscription" ON "public"."push_notification_deliveries" USING btree ("push_subscription_id");
--> statement-breakpoint

ALTER TABLE "public"."push_notification_deliveries" ENABLE ROW LEVEL SECURITY;
