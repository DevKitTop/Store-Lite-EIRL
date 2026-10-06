-- =====================================================
-- WHATSAPP CHANNEL CONNECTION STATUS — backbone signal
-- =====================================================
-- Adds connection_status to whatsapp_channels so the
-- YCloud phone status webhook can persist the latest
-- provider-reported status (pending/connected/failed).
--
-- Column DDL verified by `drizzle-kit generate` diff
-- against the schema snapshot (the journal drift between
-- 0024 and 0025..0047 makes generate unusable as-is, so
-- this file is hand-written following repo convention).
--
-- EXECUTION MODEL (MANDATORY):
--   * Autocommit: plain top-level statements, NO BEGIN/COMMIT.
--   * NEVER run via drizzle-kit: 0048 is a hand-written manual file
--     (like 0024..0047) with NO entries in migrations/meta/_journal.json.
--     Drizzle-kit must not generate or execute it.
--   * Apply manually via Supabase SQL editor.
-- =====================================================

ALTER TABLE "whatsapp_channels" ADD COLUMN "connection_status" text DEFAULT 'pending' NOT NULL;

--> statement-breakpoint

-- Backfill: active channels already connected by the existing
-- connect init/status flow transition to 'connected'.
UPDATE "whatsapp_channels" SET "connection_status" = 'connected' WHERE "is_active" = true;