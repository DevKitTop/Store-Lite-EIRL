-- First table pair migrated to the tenant policy model.
--
-- The criterion for this batch: every access comes from a signed-in member of
-- the business. Stock movements and notifications look similar but are written
-- by the checkout and by webhooks, which run without a tenant user, so they
-- stay on the system connection and out of this list.
--
-- `import_rows` has no `business_id`; its policy reaches the tenant through the
-- job it belongs to. That subquery runs under the same policies, so it is
-- exactly "rows of a job this member can see".

grant select, insert, update, delete on public.import_jobs to app_runtime;
grant select, insert, update, delete on public.import_rows to app_runtime;

drop policy if exists "import_jobs_member_access" on public.import_jobs;

create policy "import_jobs_member_access"
  on public.import_jobs
  for all
  to app_runtime
  using (public.is_business_member(business_id))
  with check (public.is_business_member(business_id));

drop policy if exists "import_rows_member_access" on public.import_rows;

create policy "import_rows_member_access"
  on public.import_rows
  for all
  to app_runtime
  using (
    exists (
      select 1
      from public.import_jobs j
      where j.id = import_rows.job_id
    )
  )
  with check (
    exists (
      select 1
      from public.import_jobs j
      where j.id = import_rows.job_id
    )
  );
