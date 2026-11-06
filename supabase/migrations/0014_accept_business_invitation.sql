-- Accepting an invitation is a capability, not a membership.
--
-- The joining user is, by definition, not a member of the business yet, so no
-- policy scoped to `is_business_member` can decide whether the insert is
-- allowed. The decision belongs to the code itself: possessing a valid,
-- unused, unexpired invitation is the authorization.
--
-- That check cannot live in application code and stay correct. Reading the
-- invitation and then inserting the membership are two statements, and between
-- them another request can consume the same single-use code. Here the row is
-- locked, the usage limit is evaluated in the same statement that reads it,
-- and the membership is written before the lock is released.
--
-- Capacity per plan stays in application code: it depends on entitlements that
-- this function has no business knowing about. Over-joining by one on a race is
-- a billing concern; a single-use code used twice is a security one.

create or replace function public.accept_business_invitation(
  p_business_id uuid,
  p_code text,
  p_user_id uuid
)
returns table (
  status text,
  invitation_id uuid
)
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_invitation public.business_invitations%rowtype;
  v_inserted integer;
begin
  if p_user_id is null then
    return query select 'unauthenticated'::text, null::uuid;
    return;
  end if;

  if exists (
    select 1 from public.businesses b
    where b.id = p_business_id and b.owner_id = p_user_id
  ) then
    return query select 'owner'::text, null::uuid;
    return;
  end if;

  if exists (
    select 1 from public.business_team_members m
    where m.business_id = p_business_id and m.user_id = p_user_id
  ) then
    return query select 'already_member'::text, null::uuid;
    return;
  end if;

  select i.*
    into v_invitation
  from public.business_invitations i
  where i.business_id = p_business_id
    and i.code = upper(p_code)
    and (i.expires_at is null or i.expires_at > now())
    and (i.max_uses is null or i.used_count < i.max_uses)
  order by i.created_at desc
  limit 1
  for update;

  if v_invitation.id is null then
    return query select 'invalid'::text, null::uuid;
    return;
  end if;

  insert into public.business_team_members (business_id, user_id, role, invitation_id)
  values (p_business_id, p_user_id, 'member', v_invitation.id)
  on conflict on constraint unique_business_user do nothing;

  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then
    return query select 'already_member'::text, null::uuid;
    return;
  end if;

  update public.business_invitations
     set used_count = used_count + 1
   where id = v_invitation.id;

  return query select 'joined'::text, v_invitation.id;
end;
$$;

revoke all on function public.accept_business_invitation(uuid, text, uuid) from public;
grant execute on function public.accept_business_invitation(uuid, text, uuid) to app_runtime;
