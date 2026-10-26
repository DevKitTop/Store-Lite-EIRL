-- =====================================================
-- 0056 — Reconcile remaining schema drift (0047 / 0053 / 0054 / 0024)
-- =====================================================
-- Production was missing, in addition to 0055:
--   1. migration 0047 (pricing restructure): enum `subscription_plan` still had
--      the legacy labels, so the deployed code could not insert the default 'lite'.
--   2. migration 0053 (`webhook_events`) — required by the Culqi webhook dedup path.
--   3. migration 0054 (`rate_limit_windows`) — shared rate-limit counters.
--   4. the `appeals` and `deactivation_notices` tables from migration 0024.
--
-- Rules honoured:
--   - ADDITIVE and IDEMPOTENT: no DROP, no DELETE, no column type changes.
--   - 0047 MUST run as individual autocommit statements: a new enum value cannot
--     be used in the same transaction that added it. The apply script executes
--     every `--> statement-breakpoint` segment independently.
--   - The 0047 UPDATEs only remap legacy labels -> new labels; amounts and
--     historical invoice data stay untouched (prod currently has 1 subscription
--     with 'basico' and 0 plan_payments rows).
-- =====================================================

-- 1. subscription_plan: add the 3 new labels (idempotent, autocommit).
ALTER TYPE "public"."subscription_plan" ADD VALUE IF NOT EXISTS 'lite';
--> statement-breakpoint

ALTER TYPE "public"."subscription_plan" ADD VALUE IF NOT EXISTS 'lite_pago';
--> statement-breakpoint

ALTER TYPE "public"."subscription_plan" ADD VALUE IF NOT EXISTS 'lite_plus';
--> statement-breakpoint

-- 2. Remap legacy subscription rows (only legacy labels are matched; re-run is a no-op).
UPDATE "business_subscriptions" SET "plan_type" = 'lite_plus' WHERE "plan_type" = 'enterprise_pro';
--> statement-breakpoint

UPDATE "business_subscriptions" SET "plan_type" = 'lite_pago' WHERE "plan_type" = 'business_pro';
--> statement-breakpoint

UPDATE "business_subscriptions" SET "plan_type" = 'lite_pago' WHERE "plan_type" = 'emprendedor';
--> statement-breakpoint

UPDATE "business_subscriptions" SET "plan_type" = 'lite' WHERE "plan_type" = 'basico';
--> statement-breakpoint

-- 3. Remap plan_payments history (plan_type only; amounts are frozen).
UPDATE "plan_payments" SET "plan_type" = 'lite_plus' WHERE "plan_type" = 'enterprise_pro';
--> statement-breakpoint

UPDATE "plan_payments" SET "plan_type" = 'lite_pago' WHERE "plan_type" = 'business_pro';
--> statement-breakpoint

UPDATE "plan_payments" SET "plan_type" = 'lite_pago' WHERE "plan_type" = 'emprendedor';
--> statement-breakpoint

UPDATE "plan_payments" SET "plan_type" = 'lite' WHERE "plan_type" = 'basico';
--> statement-breakpoint

-- 4. migration 0053 — webhook idempotency store.
CREATE TABLE IF NOT EXISTS "webhook_events" (
  "event_id" text PRIMARY KEY NOT NULL,
  "event_type" text,
  "processed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_webhook_events_expires_at" ON "webhook_events" USING btree ("expires_at");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_webhook_events_processed_at" ON "webhook_events" USING btree ("processed_at");
--> statement-breakpoint

-- 5. migration 0054 — shared rate-limit windows.
CREATE TABLE IF NOT EXISTS "rate_limit_windows" (
  "key" text NOT NULL,
  "window_start" timestamp with time zone NOT NULL,
  "count" integer DEFAULT 0 NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "rate_limit_windows_key_window_start_pk" PRIMARY KEY ("key", "window_start")
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_rate_limit_windows_expires_at" ON "rate_limit_windows" USING btree ("expires_at");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_rate_limit_windows_key" ON "rate_limit_windows" USING btree ("key");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_rate_limit_windows_window_start" ON "rate_limit_windows" USING btree ("window_start");
--> statement-breakpoint

-- 6. migration 0024 — deactivation notices (must exist before appeals FK).
CREATE TABLE IF NOT EXISTS "deactivation_notices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "business_id" uuid NOT NULL,
  "reason" "deactivation_reason" NOT NULL,
  "complaint_count" integer DEFAULT 0,
  "incomplete_order_rate" integer,
  "evidence" jsonb DEFAULT '{}',
  "notification_sent_at" timestamp with time zone,
  "notification_method" text,
  "notification_reference" text,
  "grace_period_ends_at" timestamp with time zone NOT NULL,
  "appeal_deadline" timestamp with time zone NOT NULL,
  "is_resolved" boolean DEFAULT false NOT NULL,
  "resolved_at" timestamp with time zone,
  "resolved_by" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "deactivation_notices_business_id_businesses_id_fk"
    FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint

-- 7. migration 0024 — appeals.
CREATE TABLE IF NOT EXISTS "appeals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "business_id" uuid NOT NULL,
  "deactivation_notice_id" uuid NOT NULL,
  "seller_statement" text NOT NULL,
  "seller_evidence" jsonb DEFAULT '{}',
  "submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
  "status" "appeal_status" DEFAULT 'pending' NOT NULL,
  "admin_reviewer_id" uuid,
  "admin_notes" text,
  "reviewed_at" timestamp with time zone,
  "sla_deadline" timestamp with time zone NOT NULL,
  "sla_breached" boolean DEFAULT false NOT NULL,
  "resolution" text,
  "reactivated_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "appeals_business_id_businesses_id_fk"
    FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "appeals_deactivation_notice_id_deactivation_notices_id_fk"
    FOREIGN KEY ("deactivation_notice_id") REFERENCES "public"."deactivation_notices"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "appeals_admin_reviewer_id_profiles_id_fk"
    FOREIGN KEY ("admin_reviewer_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_deactivation_notices_business_id" ON "deactivation_notices" USING btree ("business_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_deactivation_notices_reason" ON "deactivation_notices" USING btree ("reason");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_deactivation_notices_grace_ends_at" ON "deactivation_notices" USING btree ("grace_period_ends_at");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_deactivation_notices_appeal_deadline" ON "deactivation_notices" USING btree ("appeal_deadline");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_deactivation_notices_is_resolved" ON "deactivation_notices" USING btree ("is_resolved");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_deactivation_notices_created_at" ON "deactivation_notices" USING btree ("created_at" DESC NULLS LAST);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_appeals_business_id" ON "appeals" USING btree ("business_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_appeals_deactivation_notice_id" ON "appeals" USING btree ("deactivation_notice_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_appeals_status" ON "appeals" USING btree ("status");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_appeals_sla_deadline" ON "appeals" USING btree ("sla_deadline");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_appeals_submitted_at" ON "appeals" USING btree ("submitted_at" DESC NULLS LAST);
