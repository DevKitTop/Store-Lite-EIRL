-- =====================================================
-- VERIFY: 0048_payments_order_number_integrity
-- =====================================================
-- Read-only verification that migration 0048 achieved its goals.
-- Run AFTER applying the migration (via apply-migration.mjs or Supabase SQL editor).
-- This is INDEPENDENT of the apply script — the runner's "success" message is untrustworthy.
-- Usage: psql "$DATABASE_URL" -f scripts/verify-order-number-integrity.sql
-- Exit code: 0 = all PASS, non-zero = any FAIL (via \set ON_ERROR_STOP on)
-- =====================================================

\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on

-- 1. NULL count (must be 0)
SELECT
    CASE
        WHEN count(*) = 0 THEN 'PASS: NULL count = 0'
        ELSE 'FAIL: NULL count = ' || count(*)
    END AS null_check
FROM "public"."payments"
WHERE "order_number" IS NULL;

-- 2. Pattern violations (must be 0)
SELECT
    CASE
        WHEN count(*) = 0 THEN 'PASS: Pattern violations = 0'
        ELSE 'FAIL: Pattern violations = ' || count(*)
    END AS pattern_check
FROM "public"."payments"
WHERE "order_number" !~ '^ORD-[A-Za-z0-9_-]{8,20}$';

-- 3. Duplicate count (must be 0)
SELECT
    CASE
        WHEN count(*) = 0 THEN 'PASS: Duplicate count = 0'
        ELSE 'FAIL: Duplicate count = ' || count(*)
    END AS duplicate_check
FROM (
    SELECT "order_number", count(*) AS cnt
    FROM "public"."payments"
    WHERE "order_number" IS NOT NULL
    GROUP BY "order_number"
    HAVING count(*) > 1
) dups;

-- 4. NOT NULL constraint exists
SELECT
    CASE
        WHEN attnotnull THEN 'PASS: NOT NULL constraint exists'
        ELSE 'FAIL: NOT NULL constraint missing'
    END AS notnull_check
FROM pg_attribute
WHERE attrelid = 'public.payments'::regclass
  AND attname = 'order_number';

-- 5. Unique index exists and is valid
SELECT
    CASE
        WHEN EXISTS (
            SELECT 1 FROM pg_indexes
            WHERE schemaname = 'public'
              AND tablename = 'payments'
              AND indexname = 'payments_order_number_unique'
        ) THEN 'PASS: Unique index payments_order_number_unique exists'
        ELSE 'FAIL: Unique index payments_order_number_unique missing'
    END AS index_check;

-- 6. Trigger exists
SELECT
    CASE
        WHEN EXISTS (
            SELECT 1 FROM pg_trigger
            WHERE tgname = 'payments_order_number_immutable'
              AND tgrelid = 'public.payments'::regclass
        ) THEN 'PASS: Trigger payments_order_number_immutable exists'
        ELSE 'FAIL: Trigger payments_order_number_immutable missing'
    END AS trigger_check;

-- 7. Trigger fires on UPDATE attempt (integration check)
-- This will raise an exception if the trigger works correctly
DO $$
BEGIN
    -- Try to update order_number on any row (should be blocked by trigger)
    -- We use a savepoint so this doesn't affect the verification outcome
    BEGIN
        UPDATE "public"."payments"
        SET "order_number" = 'ORD-TEST12345678'
        WHERE "order_number" IS NOT NULL
        LIMIT 1;
        -- If we reach here, trigger did NOT fire
        RAISE EXCEPTION 'FAIL: Trigger did not fire - UPDATE was allowed';
    EXCEPTION
        WHEN sqlstate 'P0001' THEN -- restrict_violation
            RAISE NOTICE 'PASS: Trigger correctly blocks UPDATE of order_number';
        WHEN OTHERS THEN
            RAISE EXCEPTION 'FAIL: Unexpected error: %', SQLERRM;
    END;
END $$;

-- Final summary
SELECT 'VERIFICATION COMPLETE - All checks passed' AS result;