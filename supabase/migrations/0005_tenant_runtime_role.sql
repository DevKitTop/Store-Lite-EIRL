-- Give the database a role that row-level security actually applies to.
--
-- The application connects today with a role that carries BYPASSRLS, so every
-- policy in the schema is inert for server-side queries: the predicate is
-- never evaluated. The policies that do exist are also unusable by anyone
-- else, because the tables were never granted to the roles those policies
-- target. This migration fixes the half that can be fixed additively: a
-- runtime role with the minimum privileges to evaluate the existing
-- predicates, plus the write policies `payments` was missing.
--
-- Nothing here changes the behaviour of the current connection. Switching
-- `DATABASE_URL` to `app_runtime` is a separate, later step that requires the
-- request context (JWT claims) to be set on every tenant-scoped transaction.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_runtime') then
    create role app_runtime nologin noinherit nobypassrls nosuperuser;
  end if;
end
$$;

-- The policies call auth.uid(), which reads the request claims and is not
-- SECURITY DEFINER: the caller needs schema usage and execute on it.
grant usage on schema public to app_runtime;
grant usage on schema auth to app_runtime;
grant execute on function auth.uid() to app_runtime;

-- Read the business membership predicate. Both functions are SECURITY DEFINER
-- with an empty search_path, so no grants on their underlying tables are
-- needed — and none are given.
grant execute on function public.is_business_member(uuid) to app_runtime;

grant select, insert, update, delete on public.payments to app_runtime;

-- `payments` shipped with a SELECT policy only. Under a governed role that
-- meant every write was denied, including the seller's own transitions.
drop policy if exists "payments_insert_member" on public.payments;
drop policy if exists "payments_update_member" on public.payments;
drop policy if exists "payments_delete_member" on public.payments;

create policy "payments_insert_member"
  on public.payments for insert to public
  with check (public.is_business_member(business_id));

create policy "payments_update_member"
  on public.payments for update to public
  using (public.is_business_member(business_id))
  with check (public.is_business_member(business_id));

create policy "payments_delete_member"
  on public.payments for delete to public
  using (public.is_business_member(business_id));
