-- =====================================================
-- MIGRATION: 0048_payments_order_number_integrity
-- =====================================================
-- Description: Enforce NOT NULL, UNIQUE, and immutability on payments.order_number.
--              Backfills ONLY rows where order_number IS NULL (6 rows in DEV, 0 in PROD).
--              Adds format scan, duplicate scan, immutable UPDATE trigger.
--              Single atomic transaction (BEGIN...COMMIT) — fail-closed.
--              Operator MUST run scripts/verify-order-number-integrity.sql after apply.
--              CRITICAL: Apply ONLY after Slice 2 code is live in production!
--              See design.md ordering hazard (risk 3).
-- =====================================================

BEGIN;
SELECT pg_advisory_xact_lock(4800048);

-- 1. BACKFILL: generate server-side values for NULL rows only
-- Uses gen_random_uuid() (PG13 core, already the repo's PK default — no pgcrypto needed).
-- 12 hex chars from UUID, uppercased -> 48 bits, structurally disjoint from legacy 8-char shape.
UPDATE "public"."payments"
SET "order_number" = 'ORD-' || upper(substring(replace(gen_random_uuid()::text, '-', '') FROM 1 FOR 12))
WHERE "order_number" IS NULL;

-- 2. FORMAT SCAN: all non-null values must satisfy the pinned pattern
-- Pattern: ^ORD-[A-Za-z0-9_-]{8,20}$ (matches ORDER_NUMBER_PATTERN from Slice 1)
DO $$
DECLARE
    bad_record RECORD;
    bad_values TEXT[] := ARRAY[]::TEXT[];
BEGIN
    FOR bad_record IN
        SELECT "order_number"
        FROM "public"."payments"
        WHERE "order_number" IS NOT NULL
          AND "order_number" !~ '^ORD-[A-Za-z0-9_-]{8,20}$'
    LOOP
        bad_values := array_append(bad_values, bad_record.order_number);
    END LOOP;

    IF array_length(bad_values, 1) > 0 THEN
        RAISE EXCEPTION 'payments.order_number format violation: %', array_to_string(bad_values, ', ')
            USING ERRCODE = 'check_violation';
    END IF;
END $$;

-- 3. DUPLICATE SCAN: detect any duplicate order_number values
-- NEVER auto-resolve — renumbering breaks printed tickets/QRs.
-- Operator resolves by hand and re-runs migration.
DO $$
DECLARE
    dup_record RECORD;
    dup_values TEXT[] := ARRAY[]::TEXT[];
BEGIN
    FOR dup_record IN
        SELECT "order_number", count(*) AS cnt
        FROM "public"."payments"
        WHERE "order_number" IS NOT NULL
        GROUP BY "order_number"
        HAVING count(*) > 1
    LOOP
        dup_values := array_append(dup_values, dup_record.order_number || ' (x' || dup_record.cnt || ')');
    END LOOP;

    IF array_length(dup_values, 1) > 0 THEN
        RAISE EXCEPTION 'payments.order_number duplicate values found: %', array_to_string(dup_values, ', ')
            USING ERRCODE = 'unique_violation';
    END IF;
END $$;

-- 4. SET NOT NULL (idempotent: no-op if already NOT NULL)
ALTER TABLE "public"."payments" ALTER COLUMN "order_number" SET NOT NULL;

-- 5. UNIQUE INDEX (blocking, not CONCURRENTLY — pooler on 6543 doesn't support CONCURRENTLY)
-- 89 DEV rows / 0 PROD rows build in <1ms; SHARE lock only.
CREATE UNIQUE INDEX IF NOT EXISTS payments_order_number_unique ON "public"."payments" ("order_number");

-- 6. IMMUTABILITY TRIGGER (after backfill so it doesn't reject its own inserts)
CREATE OR REPLACE FUNCTION "public"."payments_order_number_immutable"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
AS $fn$
BEGIN
    IF NEW."order_number" IS DISTINCT FROM OLD."order_number" THEN
        RAISE EXCEPTION 'payments.order_number is immutable (row %)', OLD.id
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS payments_order_number_immutable ON "public"."payments";
CREATE TRIGGER payments_order_number_immutable
    BEFORE UPDATE OF "order_number" ON "public"."payments"
    FOR EACH ROW EXECUTE FUNCTION "public"."payments_order_number_immutable"();

-- 7. POST_CONDITIONS (run inside same transaction, after all above)
DO $$
DECLARE
    null_count INTEGER;
    pattern_violations INTEGER;
    index_exists BOOLEAN;
    trigger_exists BOOLEAN;
    notnull_exists BOOLEAN;
BEGIN
    SELECT count(*) INTO null_count FROM "public"."payments" WHERE "order_number" IS NULL;
    IF null_count > 0 THEN
        RAISE EXCEPTION 'post-condition failed: % NULL order_number rows remain', null_count
            USING ERRCODE = 'check_violation';
    END IF;

    SELECT count(*) INTO pattern_violations
    FROM "public"."payments"
    WHERE "order_number" !~ '^ORD-[A-Za-z0-9_-]{8,20}$';
    IF pattern_violations > 0 THEN
        RAISE EXCEPTION 'post-condition failed: % order_number values violate pattern', pattern_violations
            USING ERRCODE = 'check_violation';
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'payments' AND indexname = 'payments_order_number_unique'
    ) INTO index_exists;
    IF NOT index_exists THEN
        RAISE EXCEPTION 'post-condition failed: unique index payments_order_number_unique does not exist'
            USING ERRCODE = 'undefined_object';
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'payments_order_number_immutable' AND tgrelid = 'public.payments'::regclass
    ) INTO trigger_exists;
    IF NOT trigger_exists THEN
        RAISE EXCEPTION 'post-condition failed: trigger payments_order_number_immutable does not exist'
            USING ERRCODE = 'undefined_object';
    END IF;

    SELECT attnotnull INTO notnull_exists
    FROM pg_attribute
    WHERE attrelid = 'public.payments'::regclass AND attname = 'order_number';
    IF NOT notnull_exists THEN
        RAISE EXCEPTION 'post-condition failed: order_number is not NOT NULL'
            USING ERRCODE = 'check_violation';
    END IF;
END $$;

COMMIT;