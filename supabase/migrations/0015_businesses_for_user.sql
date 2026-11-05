-- The list of teams a user belongs to.
--
-- `businesses` is revoked from `app_runtime` (it holds `tax_id`,
-- `verification_data` and the legal representative's details), so a join from
-- `business_team_members` cannot run under the tenant role. The alternative was
-- leaving this read on the system client — the one client that bypasses every
-- policy — for a page that only needs three public columns and the member's own
-- role.
--
-- Scoped by the user id, never by a business id the caller supplies: the answer
-- is "your teams", and there is no parameter through which a caller could ask
-- about someone else's.

create or replace function public.businesses_for_user(p_user_id uuid)
returns table (
  business_id uuid,
  name text,
  slug text,
  role text
)
language sql
security definer
set search_path to ''
stable
as $$
  select b.id, b.name, b.slug, m.role
  from public.business_team_members m
  join public.businesses b on b.id = m.business_id
  where m.user_id = p_user_id
  order by m.joined_at, b.id;
$$;

revoke all on function public.businesses_for_user(uuid) from public;
grant execute on function public.businesses_for_user(uuid) to app_runtime;
