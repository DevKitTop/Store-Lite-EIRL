-- Extend the governed surface to the tables that answer "who is this user to
-- this business".
--
-- `payments` was the only table granted to `app_runtime`. Every seller action
-- needs one more thing before it can run under that role: the permission
-- lookup behind `checkPermission`, which reads `businesses`,
-- `business_team_members` and `business_team_roles`.
--
-- Two of those three had row-level security switched off. Granting them as
-- they were would have handed the runtime role every team membership in every
-- business — a cross-tenant read that no policy would have stopped, because
-- there was no policy to evaluate. The policies below exist for that reason,
-- not as decoration.

-- ─── business_team_members ────────────────────────────────────────────────
alter table public.business_team_members enable row level security;

drop policy if exists "business_team_members_select_member" on public.business_team_members;
drop policy if exists "business_team_members_insert_member" on public.business_team_members;
drop policy if exists "business_team_members_update_member" on public.business_team_members;
drop policy if exists "business_team_members_delete_member" on public.business_team_members;

create policy "business_team_members_select_member"
  on public.business_team_members for select to public
  using (public.is_business_member(business_id));

create policy "business_team_members_insert_member"
  on public.business_team_members for insert to public
  with check (public.is_business_member(business_id));

create policy "business_team_members_update_member"
  on public.business_team_members for update to public
  using (public.is_business_member(business_id))
  with check (public.is_business_member(business_id));

create policy "business_team_members_delete_member"
  on public.business_team_members for delete to public
  using (public.is_business_member(business_id));

-- ─── business_team_roles ──────────────────────────────────────────────────
alter table public.business_team_roles enable row level security;

drop policy if exists "business_team_roles_select_member" on public.business_team_roles;
drop policy if exists "business_team_roles_insert_member" on public.business_team_roles;
drop policy if exists "business_team_roles_update_member" on public.business_team_roles;
drop policy if exists "business_team_roles_delete_member" on public.business_team_roles;

create policy "business_team_roles_select_member"
  on public.business_team_roles for select to public
  using (public.is_business_member(business_id));

create policy "business_team_roles_insert_member"
  on public.business_team_roles for insert to public
  with check (public.is_business_member(business_id));

create policy "business_team_roles_update_member"
  on public.business_team_roles for update to public
  using (public.is_business_member(business_id))
  with check (public.is_business_member(business_id));

create policy "business_team_roles_delete_member"
  on public.business_team_roles for delete to public
  using (public.is_business_member(business_id));

-- ─── grants ───────────────────────────────────────────────────────────────
grant select, insert, update, delete on public.business_team_members to app_runtime;
grant select, insert, update, delete on public.business_team_roles to app_runtime;

-- `businesses` already carries `businesses_select_member`, so a member sees
-- only their own business. The storefront reads this table by slug with no
-- user at all, and that read has no policy yet: it must be given its own
-- context before `DATABASE_URL` is switched to `app_runtime`.
grant select on public.businesses to app_runtime;
