-- The product tables join the governed surface.
--
-- None of the three had row-level security switched on, and none had a policy.
-- That is worse than it sounds: with RLS off, any holder of the anon key can
-- select every product, price and stock level in the database. Enabling RLS is
-- therefore not decoration around the grant — it is the part that makes the
-- grant safe.
--
-- `products` and `product_categories` carry `business_id` directly.
-- `product_media` does not: it hangs off `product_id`, so its policy goes
-- through `is_product_member`, a SECURITY DEFINER helper, instead of a
-- subquery that would re-enter the products policies from inside a policy.

-- ─── products ───────────────────────────────────────────────────────────────
alter table public.products enable row level security;

drop policy if exists "products_select_member" on public.products;
drop policy if exists "products_insert_member" on public.products;
drop policy if exists "products_update_member" on public.products;
drop policy if exists "products_delete_member" on public.products;

create policy "products_select_member"
  on public.products for select to public
  using (public.is_business_member(business_id));

create policy "products_insert_member"
  on public.products for insert to public
  with check (public.is_business_member(business_id));

create policy "products_update_member"
  on public.products for update to public
  using (public.is_business_member(business_id))
  with check (public.is_business_member(business_id));

create policy "products_delete_member"
  on public.products for delete to public
  using (public.is_business_member(business_id));

-- ─── product_categories ─────────────────────────────────────────────────────
alter table public.product_categories enable row level security;

drop policy if exists "product_categories_select_member" on public.product_categories;
drop policy if exists "product_categories_insert_member" on public.product_categories;
drop policy if exists "product_categories_update_member" on public.product_categories;
drop policy if exists "product_categories_delete_member" on public.product_categories;

create policy "product_categories_select_member"
  on public.product_categories for select to public
  using (public.is_business_member(business_id));

create policy "product_categories_insert_member"
  on public.product_categories for insert to public
  with check (public.is_business_member(business_id));

create policy "product_categories_update_member"
  on public.product_categories for update to public
  using (public.is_business_member(business_id))
  with check (public.is_business_member(business_id));

create policy "product_categories_delete_member"
  on public.product_categories for delete to public
  using (public.is_business_member(business_id));

-- ─── product_media ──────────────────────────────────────────────────────────
-- Answers "does this product belong to a business the caller is a member of".
-- Takes the product id, never the business id: a caller cannot ask about a
-- business it merely claims.
create or replace function public.is_product_member(p_product_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select exists (
    select 1
    from public.products p
    where p.id = p_product_id
      and public.is_business_member(p.business_id)
  );
$$;

revoke all on function public.is_product_member(uuid) from public;
grant execute on function public.is_product_member(uuid) to app_runtime;

alter table public.product_media enable row level security;

drop policy if exists "product_media_select_member" on public.product_media;
drop policy if exists "product_media_insert_member" on public.product_media;
drop policy if exists "product_media_update_member" on public.product_media;
drop policy if exists "product_media_delete_member" on public.product_media;

create policy "product_media_select_member"
  on public.product_media for select to public
  using (public.is_product_member(product_id));

create policy "product_media_insert_member"
  on public.product_media for insert to public
  with check (public.is_product_member(product_id));

create policy "product_media_update_member"
  on public.product_media for update to public
  using (public.is_product_member(product_id))
  with check (public.is_product_member(product_id));

create policy "product_media_delete_member"
  on public.product_media for delete to public
  using (public.is_product_member(product_id));

-- ─── grants ─────────────────────────────────────────────────────────────────
grant select, insert, update, delete on public.products to app_runtime;
grant select, insert, update, delete on public.product_categories to app_runtime;
grant select, insert, update, delete on public.product_media to app_runtime;
