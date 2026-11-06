-- Create the `store-covers` bucket, which the code has always used and no
-- migration ever created.
--
-- Both the business logo and the storefront cover are uploaded here through the
-- service role (`app/actions/business.ts`, `app/create-business/actions.ts`) and
-- rendered from the public URL, so the bucket has to exist and be public. On a
-- database where it was never created by hand the upload fails and the business
-- is saved without its image: the failure is logged as non-fatal, which is why
-- it went unnoticed.
--
-- No object policy is needed here: reads of a public bucket are covered by the
-- bucket-aware policy in 0004, and the writes bypass RLS through the service
-- role. `on conflict do nothing` keeps the file safe to re-run and never flips
-- the flag on an existing bucket.

insert into storage.buckets (id, name, public)
values ('store-covers', 'store-covers', true)
on conflict (id) do nothing;
