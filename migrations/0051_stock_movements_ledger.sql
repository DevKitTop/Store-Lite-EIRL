-- =====================================================
-- MIGRATION: 0051_stock_movements_ledger
-- =====================================================
-- Description: Create `stock_movements`, the exactly-once fulfillment ledger
--              for NEW-8 ("a paid sale must move stock exactly once").
--
-- Context (design D1/D2):
--   The ledger is the completion marker shared by every fulfillment trigger
--   (charge transaction, webhook charge upsert, order.status.changed flip,
--   reconcile backstop). One row per CLAIM, unique on
--   (source_type, source_id), where source_type is 'payments' or
--   'payment_orders' — a ledger instead of a marker column because an order
--   flip can happen with no `payments` row at all.
--
--   The claim is a compare-and-swap: INSERT ... ON CONFLICT DO NOTHING ...
--   RETURNING. `rowCount` is forbidden here because drizzle-orm/postgres-js
--   DML exposes `count`/`command`, never `rowCount` (fails open).
--
--   Design: RLS enabled with ZERO policies -> every anon/authenticated access
--   is denied. The app keeps working because the authoritative path is Drizzle
--   over DATABASE_URL (the `postgres` role, which BYPASSES RLS); see
--   src/core/payments/stockFulfillment.ts.
--
--   Idempotent: safe to re-run. Do NOT add any policy here.
--   No backfill: R7 forbids retro-fulfillment of pre-deployment paid rows.
--
-- Apply via operator: psql -f migrations/0051_stock_movements_ledger.sql
--             (or paste into the Supabase SQL editor)
-- =====================================================

CREATE TABLE IF NOT EXISTS "public"."stock_movements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "business_id" uuid NOT NULL REFERENCES "public"."businesses"("id"),
  "source_type" text NOT NULL,
  "source_id" uuid NOT NULL,
  "items" jsonb NOT NULL DEFAULT '[]',
  "outcome" text NOT NULL,
  "fallback_qty1" boolean NOT NULL DEFAULT false,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "stock_movements_source_unique" UNIQUE ("source_type", "source_id"),
  CONSTRAINT "stock_movements_source_type_check"
    CHECK ("source_type" IN ('payments', 'payment_orders')),
  CONSTRAINT "stock_movements_outcome_check"
    CHECK ("outcome" IN ('fulfilled', 'partial', 'no_product'))
);

CREATE INDEX IF NOT EXISTS "idx_stock_movements_business_id"
  ON "public"."stock_movements" USING btree ("business_id");

CREATE INDEX IF NOT EXISTS "idx_stock_movements_created_at"
  ON "public"."stock_movements" USING btree ("created_at" DESC NULLS LAST);

ALTER TABLE "public"."stock_movements" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
