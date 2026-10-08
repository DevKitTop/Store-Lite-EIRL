-- Read-only verification script for order_number integrity (W-P4 + W-P5)
-- Run after applying migration 0048_payments_order_number_integrity.sql

-- 1. Check no NULL order numbers
SELECT
  CASE
    WHEN COUNT(*) = 0 THEN 'PASS: No NULL order_number rows'
    ELSE 'FAIL: ' || COUNT(*) || ' rows have NULL order_number'
  END AS null_check
FROM payments
WHERE order_number IS NULL;

-- 2. Check all order numbers match pattern
SELECT
  CASE
    WHEN COUNT(*) = 0 THEN 'PASS: All order_numbers match pattern'
    ELSE 'FAIL: ' || COUNT(*) || ' rows have invalid pattern'
  END AS pattern_check
FROM payments
WHERE order_number !~ '^ORD-[A-Za-z0-9_-]{8,20}$';

-- 3. Check no duplicates
SELECT
  CASE
    WHEN COUNT(*) = 0 THEN 'PASS: No duplicate order_numbers'
    ELSE 'FAIL: ' || COUNT(*) || ' duplicate order_number values'
  END AS duplicate_check
FROM (
  SELECT order_number, COUNT(*)
  FROM payments
  GROUP BY order_number
  HAVING COUNT(*) > 1
) d;

-- 4. Check NOT NULL constraint exists
SELECT
  CASE
    WHEN is_nullable = 'NO' THEN 'PASS: order_number is NOT NULL'
    ELSE 'FAIL: order_number allows NULL'
  END AS notnull_check
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'payments'
  AND column_name = 'order_number';

-- 5. Check UNIQUE index exists
SELECT
  CASE
    WHEN COUNT(*) > 0 THEN 'PASS: payments_order_number_unique index exists'
    ELSE 'FAIL: payments_order_number_unique index missing'
  END AS unique_index_check
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'payments'
  AND indexname = 'payments_order_number_unique';

-- 6. Check immutable trigger exists
SELECT
  CASE
    WHEN COUNT(*) > 0 THEN 'PASS: payments_order_number_immutable trigger exists'
    ELSE 'FAIL: payments_order_number_immutable trigger missing'
  END AS trigger_check
FROM pg_trigger
WHERE tgname = 'payments_order_number_immutable'
  AND tgrelid = 'public.payments'::regclass;
