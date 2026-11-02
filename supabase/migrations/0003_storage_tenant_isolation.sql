-- Storage tenant isolation.
--
-- The deployed project had four policies that filtered only on `bucket_id`:
-- any authenticated user could DELETE or UPDATE any object in the `products`
-- and `store-logos` buckets. Since every merchant's browser holds the anon key
-- and a valid session, the Storage API was directly reachable with no ownership
-- check at all.
--
-- Object paths already carry the owner for the current upload code:
--   products -> productos/<businessId>/<file>
-- so the business id is folder segment 2.
--
-- Legacy objects predate that convention: they sit flat as
-- `products/<timestamp>-<uuid>.png`, with no business segment. Those fall
-- through to deny, which is correct — they are managed server-side through the
-- service role, and RLS does not apply to it.
--
-- `store-logos` has no objects and no code reference, so its open policies are
-- dropped rather than rewritten. If a client ever writes there, it needs an
-- ownership-scoped policy using its real path convention.

drop policy if exists "Authenticated Delete" on storage.objects;
drop policy if exists "Authenticated Update" on storage.objects;
drop policy if exists "Authenticated Upload" on storage.objects;

drop policy if exists "Authenticated users can delete store logos" on storage.objects;
drop policy if exists "Authenticated users can update store logos" on storage.objects;
drop policy if exists "Authenticated users can upload store logos" on storage.objects;

-- Recreate, never accumulate: this migration may be re-run against an
-- environment that already received an earlier revision of it.
drop policy if exists "Tenant inserts own product images" on storage.objects;
drop policy if exists "Tenant updates own product images" on storage.objects;
drop policy if exists "Tenant deletes own product images" on storage.objects;

create policy "Tenant inserts own product images"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'products'
    and exists (
      select 1 from public.businesses b
      where b.id::text = (storage.foldername(storage.objects.name))[2]
        and public.is_business_member(b.id)
    )
  );

create policy "Tenant updates own product images"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'products'
    and exists (
      select 1 from public.businesses b
      where b.id::text = (storage.foldername(storage.objects.name))[2]
        and public.is_business_member(b.id)
    )
  )
  with check (
    bucket_id = 'products'
    and exists (
      select 1 from public.businesses b
      where b.id::text = (storage.foldername(storage.objects.name))[2]
        and public.is_business_member(b.id)
    )
  );

create policy "Tenant deletes own product images"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'products'
    and exists (
      select 1 from public.businesses b
      where b.id::text = (storage.foldername(storage.objects.name))[2]
        and public.is_business_member(b.id)
    )
  );
