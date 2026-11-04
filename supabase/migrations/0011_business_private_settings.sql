-- Settings is the last screen that reads the full business row.
--
-- It needs two things nobody else does: the legal representative block and the
-- merchant's Culqi credentials. Those belong to one business and to the people
-- who run it, so they are returned by a membership-checked function instead of
-- being reachable through any path that holds a business id.
--
-- `is_business_member(uuid)` answers "is the *session* user a member" because
-- that is what RLS needs. The application asks on behalf of an explicit user
-- with a governed role, so this adds the two-argument overload and uses it
-- below. Ownership counts as membership: an owner has no team row.

create or replace function public.is_business_member(
  p_business_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select exists (
    select 1
    from public.business_team_members m
    where m.business_id = p_business_id
      and m.user_id = p_user_id
  )
  or exists (
    select 1
    from public.businesses b
    where b.id = p_business_id
      and b.owner_id = p_user_id
  );
$$;

revoke all on function public.is_business_member(uuid, uuid) from public;
grant execute on function public.is_business_member(uuid, uuid) to app_runtime;

-- Returns the private half of a business for one of its members, resolved by
-- slug (including retired aliases, so the settings page can redirect instead
-- of 404). A non-member gets zero rows: the caller cannot tell a business that
-- does not exist from one they are not allowed to see.
create or replace function public.business_private_settings(
  p_slug text,
  p_user_id uuid
)
returns table (
  id uuid,
  slug text,
  legal_rep_name text,
  legal_rep_role text,
  legal_rep_phone text,
  legal_rep_email text,
  culqi_public_key text,
  culqi_secret_key text,
  preferences jsonb,
  theme_mode text
)
language sql
stable
security definer
set search_path to ''
as $$
  select
    b.id,
    b.slug,
    b.legal_rep_name,
    b.legal_rep_role,
    b.legal_rep_phone,
    b.legal_rep_email,
    s.culqi_public_key,
    s.culqi_secret_key,
    s.preferences,
    s.theme_mode
  from public.businesses b
  left join public.business_settings s on s.business_id = b.id
  left join public.business_slug_aliases a
    on a.business_id = b.id
   and a.slug = p_slug
  where (b.slug = p_slug or a.slug = p_slug)
    and public.is_business_member(b.id, p_user_id)
  order by (b.slug = p_slug) desc
  limit 1;
$$;

revoke all on function public.business_private_settings(text, uuid) from public;
grant execute on function public.business_private_settings(text, uuid) to app_runtime;
