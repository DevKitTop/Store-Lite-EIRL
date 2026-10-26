-- =====================================================
-- 0055 — Reconcile storefront schema drift
-- =====================================================
-- Production was missing part of migration 0024 (auto-deactivation /
-- complaint scoring). Because `resolveBusinessSlug` selects the full
-- `businesses` row, the missing columns made every /[slug] route fail with:
--   column "deactivation_reason" does not exist (SQLSTATE 42703)
--
-- This migration is ADDITIVE and IDEMPOTENT:
--   - no DROP, no DELETE, no type changes, no data rewrites
--   - safe to re-run
--
-- It only restores the columns/enums/indexes required by the code that is
-- already deployed. Tables `appeals` and `deactivation_notices` are NOT
-- created here; they are part of the remaining 0024 reconciliation and are
-- not needed to render the storefront.
-- =====================================================

DO $$ BEGIN
  CREATE TYPE "public"."deactivation_reason" AS ENUM ('verified_complaints', 'incomplete_orders');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE TYPE "public"."appeal_status" AS ENUM ('pending', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE TYPE "public"."complaint_score_tier" AS ENUM ('verified', 'under_review', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "deactivation_reason" "deactivation_reason";
--> statement-breakpoint

ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "deactivation_date" timestamp with time zone;
--> statement-breakpoint

ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "appeal_status" "appeal_status";
--> statement-breakpoint

ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "grace_period_ends_at" timestamp with time zone;
--> statement-breakpoint

ALTER TABLE "complaint_book_records" ADD COLUMN IF NOT EXISTS "score" integer DEFAULT 0;
--> statement-breakpoint

ALTER TABLE "complaint_book_records" ADD COLUMN IF NOT EXISTS "score_tier" "complaint_score_tier" DEFAULT 'rejected';
--> statement-breakpoint

ALTER TABLE "complaint_book_records" ADD COLUMN IF NOT EXISTS "score_breakdown" jsonb DEFAULT '{}';
--> statement-breakpoint

ALTER TABLE "complaint_book_records" ADD COLUMN IF NOT EXISTS "is_verified" boolean DEFAULT false NOT NULL;
--> statement-breakpoint

ALTER TABLE "complaint_book_records" ADD COLUMN IF NOT EXISTS "verified_at" timestamp with time zone;
--> statement-breakpoint

ALTER TABLE "complaint_book_records" ADD COLUMN IF NOT EXISTS "linked_order_id" uuid;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_businesses_deactivation_reason" ON "businesses" USING btree ("deactivation_reason");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_businesses_appeal_status" ON "businesses" USING btree ("appeal_status");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_businesses_grace_period_ends_at" ON "businesses" USING btree ("grace_period_ends_at");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_cbr_score_tier" ON "complaint_book_records" USING btree ("business_id", "score_tier");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_cbr_is_verified" ON "complaint_book_records" USING btree ("business_id", "is_verified") WHERE "complaint_book_records"."is_verified" = true;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_cbr_linked_order_id" ON "complaint_book_records" USING btree ("linked_order_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_cbr_verified_at" ON "complaint_book_records" USING btree ("verified_at" DESC NULLS LAST);
