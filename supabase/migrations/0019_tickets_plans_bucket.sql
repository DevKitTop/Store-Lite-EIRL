-- Create the private `tickets_plans` bucket for SaaS plan receipts.
--
-- Plan receipts were uploaded straight from the browser with the anonymous key
-- into a bucket that holds buyer PII (name, document, email). They now follow
-- the same rule as order receipts (0004): the API uploads with the service role
-- and every reader receives a short-lived signed URL.
--
-- Private means no public read: the policy installed by 0004 only grants SELECT
-- on buckets whose `public` flag is true, so flipping the flag is enough. The
-- write side needs no policy at all, because the service role bypasses RLS.
--
-- The upsert makes this converge on every environment: it creates the bucket
-- where it is missing and closes a bucket that an earlier hand-made deployment
-- left public. Re-running it is a no-op.

insert into storage.buckets (id, name, public)
values ('tickets_plans', 'tickets_plans', false)
on conflict (id) do update set public = false;
