-- =====================================================
-- 0059 - Promotions and redemptions (new-user offer + campaigns)
-- =====================================================
-- Campaign catalog and per-owner redemption ledger for the billing
-- promotions engine. A free period grants a paid plan for N days without a
-- charge; percent/fixed campaigns discount a real Culqi purchase.
--
-- ADDITIVE and IDEMPOTENT:
--   - no DROP TABLE, no DROP COLUMN, no DELETE, no data rewrites
--   - one redemption per campaign and owner
--   - amounts are integer cents (never floating point)
--   - server-only tables: RLS enabled with no client policies
-- =====================================================

CREATE TABLE IF NOT EXISTS "public"."promotions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "type" text NOT NULL,
  "plan_scope" text DEFAULT 'lite_pago' NOT NULL,
  "period_scope" text DEFAULT 'any' NOT NULL,
  "duration_days" integer,
  "percent_off" integer,
  "amount_off_cents" integer,
  "eligibility" text NOT NULL,
  "starts_at" timestamp with time zone DEFAULT now() NOT NULL,
  "ends_at" timestamp with time zone,
  "max_redemptions" integer,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "promotions_code_unique" UNIQUE ("code"),
  CONSTRAINT "promotions_type_check" CHECK ("type" IN ('free_period', 'percent_off', 'fixed_off')),
  CONSTRAINT "promotions_plan_scope_check" CHECK ("plan_scope" IN ('lite_pago', 'lite_plus', 'any')),
  CONSTRAINT "promotions_period_scope_check" CHECK ("period_scope" IN ('monthly', 'annual', 'any')),
  CONSTRAINT "promotions_eligibility_check" CHECK ("eligibility" IN ('new_owner', 'all_users', 'code', 'manual')),
  CONSTRAINT "promotions_value_check" CHECK (
    ("type" = 'free_period' AND "duration_days" IS NOT NULL AND "duration_days" > 0
      AND "percent_off" IS NULL AND "amount_off_cents" IS NULL)
    OR ("type" = 'percent_off' AND "percent_off" IS NOT NULL AND "percent_off" BETWEEN 1 AND 99
      AND "duration_days" IS NULL AND "amount_off_cents" IS NULL)
    OR ("type" = 'fixed_off' AND "amount_off_cents" IS NOT NULL AND "amount_off_cents" > 0
      AND "duration_days" IS NULL AND "percent_off" IS NULL)
  ),
  CONSTRAINT "promotions_window_check" CHECK ("ends_at" IS NULL OR "ends_at" > "starts_at"),
  CONSTRAINT "promotions_max_redemptions_check" CHECK ("max_redemptions" IS NULL OR "max_redemptions" > 0)
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_promotions_active_window" ON "public"."promotions" USING btree ("is_active", "starts_at", "ends_at");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "public"."promotion_redemptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "promotion_id" uuid NOT NULL REFERENCES "public"."promotions"("id") ON DELETE CASCADE,
  "business_id" uuid NOT NULL REFERENCES "public"."businesses"("id") ON DELETE CASCADE,
  "owner_id" uuid NOT NULL REFERENCES "public"."profiles"("id") ON DELETE CASCADE,
  "plan_payment_id" uuid REFERENCES "public"."plan_payments"("id") ON DELETE SET NULL,
  "original_amount_cents" integer DEFAULT 0 NOT NULL,
  "discount_amount_cents" integer DEFAULT 0 NOT NULL,
  "final_amount_cents" integer DEFAULT 0 NOT NULL,
  "status" text DEFAULT 'granted' NOT NULL,
  "redeemed_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "promotion_redemptions_unique" UNIQUE ("promotion_id", "owner_id"),
  CONSTRAINT "promotion_redemptions_status_check" CHECK ("status" IN ('granted', 'consumed', 'reversed')),
  CONSTRAINT "promotion_redemptions_amounts_check" CHECK (
    "original_amount_cents" >= 0
    AND "discount_amount_cents" >= 0
    AND "final_amount_cents" >= 0
  )
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_promotion_redemptions_promotion" ON "public"."promotion_redemptions" USING btree ("promotion_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_promotion_redemptions_business" ON "public"."promotion_redemptions" USING btree ("business_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_promotion_redemptions_owner" ON "public"."promotion_redemptions" USING btree ("owner_id");
--> statement-breakpoint

ALTER TABLE "public"."promotions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

ALTER TABLE "public"."promotion_redemptions" ENABLE ROW LEVEL SECURITY;
