-- Answer "does this user own this business" without granting the table.
--
-- `0006` granted SELECT on `businesses` to `app_runtime`, and that was too
-- broad: the table carries `tax_id`, `verification_data`, `legal_rep_email`,
-- `penalty_debt` and the owner linkage, and row-level security filters rows,
-- never columns. With a single runtime role serving both the seller panel and
-- the public storefront, a table grant means every one of those columns is
-- readable from whichever query the application happens to run.
--
-- The seller permission check only needed one bit of information from that
-- table, so it moves into a SECURITY DEFINER function, the same shape as
-- `is_business_member`, and the table grant is withdrawn. What is not granted
-- cannot be read, regardless of the query.

create or replace function public.is_business_owner(
  target_business_id uuid,
  target_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select exists (
    select 1
    from public.businesses
    where id = target_business_id
      and owner_id = target_user_id
  );
$$;

revoke all on function public.is_business_owner(uuid, uuid) from public;
grant execute on function public.is_business_owner(uuid, uuid) to app_runtime;

revoke select on public.businesses from app_runtime;
