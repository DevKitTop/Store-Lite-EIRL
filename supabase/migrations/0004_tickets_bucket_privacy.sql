-- Make the `tickets` bucket private.
--
-- It holds courier receipts (delivery proof, often with the customer's address
-- visible on the label) and checkout receipts. The bucket was created with
-- `public = true` in migrations/0018_create_tickets_bucket.sql, backed by a
-- policy that granted SELECT to every object in the bucket.
--
-- That policy is not the only problem. `storage.objects` also carries a policy
-- named "Public Access" whose USING clause has no bucket filter at all, so it
-- grants anonymous read on every object in every bucket, including buckets that
-- are supposed to be private. Making a bucket private without fixing that
-- policy would change nothing: the catch-all still applies.
--
-- The catch-all is replaced by an equivalent grant restricted to buckets that
-- are actually marked public, so the existing public buckets keep working and
-- any bucket flipped to private later is honoured automatically.

update storage.buckets
set public = false
where id = 'tickets';

drop policy if exists "Public Access" on storage.objects;

drop policy if exists "Public read of public buckets" on storage.objects;

create policy "Public read of public buckets"
  on storage.objects for select to public
  using (
    exists (
      select 1
      from storage.buckets b
      where b.id = bucket_id
        and b.public = true
    )
  );
