-- Add the three fields the storefront already publishes.
--
-- `tax_id` reaches the page as `businessRuc` and is emitted through
-- structured data; `geo_region` and `geo_placename` feed the local SEO
-- metadata. Leaving them out of the projection would not be hardening, it
-- would silently drop data the storefront shows today.
--
-- The function's OUT parameters change, so `create or replace` cannot be used:
-- it is dropped and recreated, and the grants are re-applied afterwards.

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
  geo_region text,
  geo_placename text,
  departamento text,
  provincia text,
  distrito text,
  email text,
  person_type text,
  verification_status text,
  created_at timestamp with time zone,
  latitude numeric,
  longitude numeric,
  tax_id text,
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
    b.geo_region,
    b.geo_placename,
    b.departamento,
    b.provincia,
    b.distrito,
    b.email,
    b.person_type,
    b.verification_status,
    b.created_at,
    b.latitude,
    b.longitude,
    b.tax_id,
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
