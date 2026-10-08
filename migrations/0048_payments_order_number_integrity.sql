-- =====================================================
-- PAYMENTS ORDER NUMBER INTEGRITY (W-P4 + W-P5)
-- =====================================================
-- Enforces payments.order_number as NOT NULL + UNIQUE
-- and makes it immutable. Backfills ONLY NULL rows.
-- PROD has 0 rows; DEV has 89 (6 NULL, 83 valid, 2 with ticket_url).
-- =====================================================

BEGIN;

-- Advisory lock to prevent concurrent runs
SELECT pg_advisory_xact_lock(4800048);

-- 1. Backfill only NULL order_number rows
WITH backfill AS (
  SELECT
    id,
    'ORD-' || regexp_replace(gen_random_uuid()::text, '[^A-Za-z0-9_-]', '', 'g') AS new_order_number
  FROM payments
  WHERE order_number IS NULL
)
UPDATE payments p
SET order_number = b.new_order_number
FROM backfill b
WHERE p.id = b.id;

-- 2. Format scan
DO $$
DECLARE
  bad_count integer;
BEGIN
  SELECT count(*)
  INTO bad_count
  FROM payments
  WHERE order_number IS NULL OR order_number !~ '^ORD-[A-Za-z0-9_-]{8,20}$';
  IF bad_count > 0 THEN
    RAISE EXCEPTION 'order_number format validation failed: % rows have invalid format', bad_count;
  END IF;
END$$;

-- 3. Duplicate scan
DO $$
DECLARE
  dup_count integer;
BEGIN
  SELECT count(*)
  INTO dup_count
  FROM (
    SELECT order_number, count(*)
    FROM payments
    GROUP BY order_number
    HAVING count(*) > 1
  ) d;
  IF dup_count > 0 THEN
    RAISE EXCEPTION 'order_number duplicate validation failed: % duplicate values found', dup_count;
  END IF;
END$$;

-- 4. Set NOT NULL
ALTER TABLE payments ALTER COLUMN order_number SET NOT NULL;

-- 5. Create UNIQUE index
CREATE UNIQUE INDEX IF NOT EXISTS payments_order_number_unique ON payments (order_number);

-- 6. Trigger to prevent order_number mutation
CREATE OR REPLACE FUNCTION prevent_order_number_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.order_number IS DISTINCT FROM NEW.order_number THEN
    RAISE EXCEPTION 'payments.order_number is immutable and cannot be changed' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END$$;

CREATE TRIGGER payments_order_number_immutable
  BEFORE UPDATE OF order_number
  ON payments
  FOR EACH ROW
  EXECUTE FUNCTION prevent_order_number_update();

-- 7. Post-conditions verification
DO $$
DECLARE
  null_count integer;
  dup_count integer;
BEGIN
  SELECT count(*) INTO null_count FROM payments WHERE order_number IS NULL;
  IF null_count > 0 THEN
    RAISE EXCEPTION 'Post-condition failed: % rows still have NULL order_number', null_count;
  END IF;
  SELECT count(*) INTO dup_count FROM (
    SELECT order_number, count(*) FROM payments GROUP BY order_number HAVING count(*) > 1
  ) d;
  IF dup_count > 0 THEN
    RAISE EXCEPTION 'Post-condition failed: % duplicate order_number values', dup_count;
  END IF;
END$$;

COMMIT;