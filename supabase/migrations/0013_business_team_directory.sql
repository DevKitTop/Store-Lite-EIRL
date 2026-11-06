-- The team roster, readable only by the people who are on it.
--
-- Two tables are involved and neither can be granted as it stands:
-- `business_team_members` is already scoped by `is_business_member`, but the
-- profile shown next to each row lives in `users`, which no tenant-scoped read
-- may touch. The current code solves that by reading both tables as the owning
-- role and filtering in application code: one forgotten `where` and every
-- tenant's team list is public.
--
-- This function returns the whole roster for one business, and nothing at all
-- for anyone who is not on it. The caller cannot reach `users`; it only sees
-- the columns that belong in a roster.
--
-- What it deliberately does not return: the owner's join date. Ownership has no
-- membership row, so any value would be invented; the caller keeps the
-- placeholder it already displays.

create or replace function public.business_team_directory(
  p_business_id uuid,
  p_user_id uuid
)
returns table (
  kind text,
  membership_id uuid,
  user_id uuid,
  email text,
  full_name text,
  avatar_url text,
  role text,
  joined_at timestamptz
)
language plpgsql
stable
security definer
set search_path to ''
as $$
begin
  if not public.is_business_member(p_business_id, p_user_id) then
    return;
  end if;

  return query
  select roster.*
  from (
    select
      'owner'::text as kind,
      null::uuid as membership_id,
      b.owner_id as user_id,
      u.email,
      u.full_name,
      u.avatar_url,
      'owner'::text as role,
      null::timestamptz as joined_at
    from public.businesses b
    join public.profiles u on u.id = b.owner_id
    where b.id = p_business_id

    union all

    select
      'member'::text,
      m.id,
      m.user_id,
      u.email,
      u.full_name,
      u.avatar_url,
      m.role,
      m.joined_at
    from public.business_team_members m
    join public.profiles u on u.id = m.user_id
    where m.business_id = p_business_id
  ) as roster
  order by (roster.kind = 'owner') desc, roster.joined_at asc nulls first;
end;
$$;

revoke all on function public.business_team_directory(uuid, uuid) from public;
grant execute on function public.business_team_directory(uuid, uuid) to app_runtime;
