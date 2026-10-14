-- =====================================================
-- MIGRATION: 0049_enable_rls_sensitive_tables
-- =====================================================
-- Description: Enable Row Level Security on five tables that were reachable
--              through the public (anon) Supabase key with no RLS protection:
--              businesses, payments, payment_orders, chat_sessions, messages.
--
-- Context (C1 — pre-production security verification, 2026-10):
--   All three supabase-js clients (client.ts / server.ts / proxy.ts) use ONLY
--   NEXT_PUBLIC_SUPABASE_ANON_KEY. With RLS OFF, these tables are readable via
--   PostgREST by anyone holding the public key. The authoritative app data path
--   is Drizzle over DATABASE_URL (the `postgres` role), which BYPASSES RLS — so
--   the policies below do NOT affect normal reads/writes.
--
--   Access surface that MUST keep working (authenticated seller):
--     - src/lib/supabase/proxy.ts -> SELECT businesses WHERE owner_id = user.id
--     - seller chat realtime      -> SELECT chat_sessions / messages by membership
--
--   Accepted degradation (Path A): unauthenticated buyers subscribe to
--   `payments` (OrderRealtimeHandler) and `messages` (OrderChatSection) via
--   Supabase Realtime. Realtime honors RLS, so those anon subscriptions are now
--   denied. Chat degrades to its existing 5s polling fallback; order status
--   degrades to manual refresh. Restoring buyer realtime requires anonymous
--   auth (tracked as a follow-up, out of scope here).
--
--   Why a helper function instead of the inline subquery used by 0019:
--   PostgreSQL raises "infinite recursion detected in policy" when a policy's
--   subquery re-enters a self-referential policy. The existing
--   `team_can_view_members` policy on business_team_members is self-referential
--   (it SELECTs business_team_members inside its own USING clause), so any RLS
--   policy that reads business_team_members via a subquery risks that error.
--   A SECURITY DEFINER function evaluates the membership lookup outside RLS,
--   which is the Supabase-recommended way to avoid the recursion.
--
--   Recursion-safety depends on the function running as its OWNER (`postgres`)
--   with RLS merely ENABLED (not FORCEd) on the tables it reads: the owner
--   bypasses RLS, so is_business_member does not re-enter the policies that
--   call it. If this function is ever recreated by a non-owner role, or if
--   FORCE ROW LEVEL SECURITY is set on business_team_members/businesses, then
--   businesses_select_member -> is_business_member -> businesses will recurse.
--
--   Writes are intentionally NOT allowed through PostgREST: only FOR SELECT
--   policies exist, so INSERT/UPDATE/DELETE by anon/authenticated non-owner
--   roles are denied on these tables. All writes go through Drizzle (the
--   `postgres` role, which bypasses RLS).
--
--   Idempotent: safe to re-run. Do NOT add any anon/public policy.
--
-- Apply via operator: psql -f migrations/0049_enable_rls_sensitive_tables.sql
--             (or paste into the Supabase SQL editor)
-- =====================================================

-- Step 1: membership helper (bypasses RLS internally -> no policy recursion).
CREATE OR REPLACE FUNCTION public.is_business_member(target_business_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.business_team_members
    WHERE business_id = target_business_id
      AND user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM public.businesses
    WHERE id = target_business_id
      AND owner_id = auth.uid()
  );
$$;
--> statement-breakpoint

-- Step 2: enable RLS on the five sensitive tables
ALTER TABLE "public"."businesses" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."payments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."payment_orders" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."chat_sessions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."messages" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Step 3: drop any conflicting / half-broken policies so the ones below are the
--         single source of truth (idempotent re-apply).
DROP POLICY IF EXISTS "businesses_select_member" ON "public"."businesses";
--> statement-breakpoint
DROP POLICY IF EXISTS "payments_select_member" ON "public"."payments";
--> statement-breakpoint
DROP POLICY IF EXISTS "payment_orders_select_member" ON "public"."payment_orders";
--> statement-breakpoint
DROP POLICY IF EXISTS "chat_sessions_select_member" ON "public"."chat_sessions";
--> statement-breakpoint
DROP POLICY IF EXISTS "messages_select_member" ON "public"."messages";
--> statement-breakpoint

-- Step 4: SELECT policies scoped to business membership (auth.uid()).
--         No anon/public policy: unauthenticated PostgREST access is denied.

-- businesses: owner OR team member.
CREATE POLICY "businesses_select_member" ON "public"."businesses"
  FOR SELECT
  USING (public.is_business_member(id));
--> statement-breakpoint

-- payments / payment_orders / chat_sessions: direct business_id column.
CREATE POLICY "payments_select_member" ON "public"."payments"
  FOR SELECT
  USING (public.is_business_member(business_id));
--> statement-breakpoint

CREATE POLICY "payment_orders_select_member" ON "public"."payment_orders"
  FOR SELECT
  USING (public.is_business_member(business_id));
--> statement-breakpoint

CREATE POLICY "chat_sessions_select_member" ON "public"."chat_sessions"
  FOR SELECT
  USING (public.is_business_member(business_id));
--> statement-breakpoint

-- messages: no business_id column -> resolve the tenant through the parent
-- chat_session, then reuse the same membership helper.
CREATE POLICY "messages_select_member" ON "public"."messages"
  FOR SELECT
  USING (
    public.is_business_member(
      (SELECT cs.business_id FROM "public"."chat_sessions" cs WHERE cs.id = session_id)
    )
  );
