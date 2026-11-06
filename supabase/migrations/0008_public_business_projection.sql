-- Public storefront projection.
--
-- The public pages (`/[slug]/terminos`, `/devoluciones`,
-- `/libro-reclamaciones`) resolve the business by slug with no user session.
-- Until now they used `resolveBusinessSlug`, which returns the whole row -
-- including `tax_id`, `verification_data`, `legal_rep_email`, `penalty_debt`
-- and `owner_id`.
--
-- Under a single runtime role there is no way to grant the seller columns and
-- withhold the public ones: row-level security filters rows, never columns, so
-- any table grant applies to every query the application runs. The boundary
-- therefore has to be a projection, not a policy.
--
-- This function exposes exactly what an anonymous visitor may see, keeps the
-- alias resolution the public routes rely on, and leaves the table ungranted.
-- `app_runtime` receives EXECUTE and nothing else.

-- Dropped first so this file can be re-applied. 0009 changes the OUT
-- parameters, and `create or replace` cannot change a return type, so on a
-- database that already ran 0009 the replace below fails with 42P13. The grant
-- is re-applied afterwards, in the same transaction.
drop function if exists public.public_business_by_slug(text);

create function public.public_business_by_slug(target_slug text)
returns table (
  id uuid,
  slug text,
  name text,
  logo_url text,
  cover_image_url text,
  description text,
  store_type text,
  whatsapp_number text,
  address text,
  city text,
  country text,
  social_links jsonb,
  hero_images text[],
  seo_title text,
  seo_description text,
  seo_keywords text,
  payment_flow text[],
  latitude numeric,
  longitude numeric,
  is_active boolean
)
language sql
stable
security definer
set search_path to ''
as $$
  select
    b.id,
    b.slug,
    b.name,
    b.logo_url,
    b.cover_image_url,
    b.description,
    b.store_type,
    b.whatsapp_number,
    b.address,
    b.city,
    b.country,
    b.social_links,
    b.hero_images,
    b.seo_title,
    b.seo_description,
    b.seo_keywords,
    b.payment_flow,
    b.latitude,
    b.longitude,
    b.is_active
  from public.businesses b
  left join public.business_slug_aliases a
    on a.business_id = b.id
   and a.slug = target_slug
  where b.slug = target_slug
     or a.slug = target_slug
  order by (b.slug = target_slug) desc
  limit 1;
$$;

revoke all on function public.public_business_by_slug(text) from public;
grant execute on function public.public_business_by_slug(text) to app_runtime;
