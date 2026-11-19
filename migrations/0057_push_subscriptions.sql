-- =====================================================
-- 0057 - Push subscriptions (PWA P2, T2.1)
-- =====================================================
-- Stores Web Push subscriptions per authenticated user/device (endpoint).
-- Server-only delivery uses privileged/admin DB client (bypasses RLS) and
-- must validate membership/authorization at send time; client access is
-- owner-only via RLS.
--
-- ADDITIVE and IDEMPOTENT:
--   - no DROP TABLE, no DROP COLUMN, no DELETE, no type changes, no data rewrites
--   - policies are dropped only with IF EXISTS and recreated (safe to re-run)
-- =====================================================

CREATE TABLE IF NOT EXISTS "public"."push_subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "public"."profiles"("id") ON DELETE CASCADE,
  "endpoint" text NOT NULL,
  "p256dh" text NOT NULL,
  "auth" text NOT NULL,
  "expiration_time" timestamp with time zone,
  "user_agent" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_seen_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "invalidated_at" timestamp with time zone,
  "failure_count" integer DEFAULT 0 NOT NULL,
  "last_failure_at" timestamp with time zone,
  "last_failure_code" text,
  CONSTRAINT "push_subscriptions_user_id_endpoint_unique" UNIQUE ("user_id", "endpoint")
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_push_subscriptions_user_id" ON "public"."push_subscriptions" USING btree ("user_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_push_subscriptions_active_user_id" ON "public"."push_subscriptions" USING btree ("user_id") WHERE "revoked_at" IS NULL AND "invalidated_at" IS NULL;
--> statement-breakpoint

ALTER TABLE "public"."push_subscriptions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DROP POLICY IF EXISTS "push_subscriptions_select_owner" ON "public"."push_subscriptions";
--> statement-breakpoint

CREATE POLICY "push_subscriptions_select_owner" ON "public"."push_subscriptions"
  FOR SELECT
  USING ("user_id" = auth.uid());
--> statement-breakpoint

DROP POLICY IF EXISTS "push_subscriptions_insert_owner" ON "public"."push_subscriptions";
--> statement-breakpoint

CREATE POLICY "push_subscriptions_insert_owner" ON "public"."push_subscriptions"
  FOR INSERT
  WITH CHECK ("user_id" = auth.uid());
--> statement-breakpoint

DROP POLICY IF EXISTS "push_subscriptions_update_owner" ON "public"."push_subscriptions";
--> statement-breakpoint

CREATE POLICY "push_subscriptions_update_owner" ON "public"."push_subscriptions"
  FOR UPDATE
  USING ("user_id" = auth.uid())
  WITH CHECK ("user_id" = auth.uid());
--> statement-breakpoint

DROP POLICY IF EXISTS "push_subscriptions_delete_owner" ON "public"."push_subscriptions";
--> statement-breakpoint

CREATE POLICY "push_subscriptions_delete_owner" ON "public"."push_subscriptions"
  FOR DELETE
  USING ("user_id" = auth.uid());