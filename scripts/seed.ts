/**
 * Local development seed.
 *
 * Gives a fresh local Supabase instance enough data for the storefront to
 * render, so development no longer depends on the shared cloud project.
 *
 * Safety rules:
 *   - Refuses to run when NODE_ENV=production.
 *   - Refuses to run when DATABASE_URL or NEXT_PUBLIC_SUPABASE_URL does not
 *     resolve to 127.0.0.1 / localhost.
 *   - Idempotent: every write is an upsert keyed on a stable natural key.
 *     No DELETE, no TRUNCATE.
 *
 * Usage: pnpm db:seed
 *
 * Note: the local database is built with `drizzle-kit push`, so it contains
 * tables and columns only. Triggers, RLS policies and SQL functions from
 * `migrations/` are NOT present locally, which is why the owner profile is
 * inserted explicitly instead of relying on the `on_auth_user_created` trigger.
 */
import 'dotenv/config';
import postgres from 'postgres';

const SEED_EMAIL = 'owner@storelite.test';
const SEED_PASSWORD = 'Seed1234!';
const SEED_FULL_NAME = 'Demo Owner';
const BUSINESS_SLUG = 'demo-store';

function abort(message: string): never {
  console.error(`\n  ABORT: ${message}\n  Nothing was written to the database.\n`);
  process.exit(1);
}

function parseHost(value: string | undefined, label: string): string {
  if (!value) abort(`${label} is not set in the environment.`);
  try {
    return new URL(value).hostname;
  } catch {
    abort(`${label} is not a valid URL.`);
  }
}

if (process.env.NODE_ENV === 'production') {
  abort('Refusing to seed while NODE_ENV=production.');
}

const databaseHost = parseHost(process.env.DATABASE_URL, 'DATABASE_URL');
const supabaseHost = parseHost(process.env.NEXT_PUBLIC_SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL');

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

if (!LOCAL_HOSTS.has(databaseHost)) {
  abort(`DATABASE_URL points to "${databaseHost}". This seed only targets a local database.`);
}
if (!LOCAL_HOSTS.has(supabaseHost)) {
  abort(
    `NEXT_PUBLIC_SUPABASE_URL points to "${supabaseHost}". This seed only targets local Supabase.`,
  );
}

const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!serviceRoleKey) abort('SUPABASE_SERVICE_ROLE_KEY is not set.');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const sql = postgres(process.env.DATABASE_URL as string, { max: 1, connect_timeout: 10 });

const authHeaders: Record<string, string> = {
  apikey: serviceRoleKey,
  Authorization: `Bearer ${serviceRoleKey}`,
  'Content-Type': 'application/json',
};

interface AuthUser {
  id: string;
  email?: string;
}

async function ensureAuthUser(): Promise<string> {
  const listResponse = await fetch(`${supabaseUrl}/auth/v1/admin/users?page=1&per_page=200`, {
    headers: authHeaders,
  });

  if (listResponse.ok) {
    const payload = (await listResponse.json()) as { users?: AuthUser[] };
    const existing = payload.users?.find((user) => user.email === SEED_EMAIL);
    if (existing?.id) return existing.id;
  }

  const createResponse = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      email: SEED_EMAIL,
      password: SEED_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: SEED_FULL_NAME },
    }),
  });

  if (!createResponse.ok) {
    const detail = await createResponse.text();
    abort(`Could not create the seed user (HTTP ${createResponse.status}). ${detail}`);
  }

  const created = (await createResponse.json()) as AuthUser;
  if (!created?.id) abort('The Admin API did not return a user id.');
  return created.id;
}

const CATEGORIES = [
  { slug: 'ropa', name: 'Ropa' },
  { slug: 'accesorios', name: 'Accesorios' },
] as const;

const PRODUCTS = [
  {
    slug: 'polo-algodon',
    title: 'Polo de algodón',
    price: '39.90',
    stock: 25,
    category: 'ropa',
    saleStatus: 'NORMAL',
    stars: 4,
  },
  {
    slug: 'casaca-denim',
    title: 'Casaca denim',
    price: '129.90',
    stock: 10,
    category: 'ropa',
    saleStatus: 'MAS_VENDIDO',
    stars: 5,
  },
  {
    slug: 'pantalon-cargo',
    title: 'Pantalón cargo',
    price: '89.90',
    stock: 18,
    category: 'ropa',
    saleStatus: 'NUEVO_PRODUCTO',
    stars: 4,
  },
  {
    slug: 'gorra-bordada',
    title: 'Gorra bordada',
    price: '45.00',
    stock: 40,
    category: 'accesorios',
    saleStatus: 'NORMAL',
    stars: 4,
  },
  {
    slug: 'mochila-urbana',
    title: 'Mochila urbana',
    price: '149.90',
    stock: 7,
    category: 'accesorios',
    saleStatus: 'NORMAL',
    stars: 5,
  },
  {
    slug: 'taza-ceramica',
    title: 'Taza de cerámica',
    price: '25.00',
    stock: 60,
    category: 'accesorios',
    saleStatus: 'NORMAL',
    stars: 3,
  },
] as const;

async function main(): Promise<void> {
  console.log(`\nSeeding local database at ${databaseHost}\n`);

  const ownerId = await ensureAuthUser();
  console.log(`  auth user .......... ${SEED_EMAIL}`);

  await sql`
    insert into profiles (id, email, full_name)
    values (${ownerId}, ${SEED_EMAIL}, ${SEED_FULL_NAME})
    on conflict (id) do update
      set email = excluded.email,
          full_name = excluded.full_name,
          updated_at = now()
  `;

  const [business] = await sql<{ id: string }[]>`
    insert into businesses (
      owner_id, name, slug, description, city, country,
      logo_url, cover_image_url, whatsapp_number,
      is_active, verification_status, seo_title, seo_description
    ) values (
      ${ownerId},
      ${'Demo Store'},
      ${BUSINESS_SLUG},
      ${'Tienda de demostración para desarrollo local.'},
      ${'Lima'},
      ${'PE'},
      ${`https://picsum.photos/seed/${BUSINESS_SLUG}-logo/200/200`},
      ${`https://picsum.photos/seed/${BUSINESS_SLUG}-cover/1200/400`},
      ${'+51999999999'},
      true,
      ${'verified'},
      ${'Demo Store'},
      ${'Tienda de demostración para desarrollo local.'}
    )
    on conflict (slug) do update
      set owner_id = excluded.owner_id,
          name = excluded.name,
          description = excluded.description,
          city = excluded.city,
          country = excluded.country,
          logo_url = excluded.logo_url,
          cover_image_url = excluded.cover_image_url,
          whatsapp_number = excluded.whatsapp_number,
          is_active = excluded.is_active,
          verification_status = excluded.verification_status,
          seo_title = excluded.seo_title,
          seo_description = excluded.seo_description,
          updated_at = now()
    returning id
  `;

  const businessId = business.id;

  await sql`
    insert into business_settings (business_id, theme_mode, contrast_level)
    values (${businessId}, ${'light'}, ${'standard'})
    on conflict (business_id) do update
      set theme_mode = excluded.theme_mode,
          contrast_level = excluded.contrast_level,
          updated_at = now()
  `;

  await sql`
    insert into business_subscriptions (business_id, plan_type, plan_status, plan_start_date)
    values (${businessId}, ${'lite_pago'}, ${'active'}, now())
    on conflict (business_id) do update
      set plan_type = excluded.plan_type,
          plan_status = excluded.plan_status,
          plan_updated_at = now()
  `;

  const categoryIds = new Map<string, string>();
  for (const [index, category] of CATEGORIES.entries()) {
    const [row] = await sql<{ id: string }[]>`
      insert into product_categories (business_id, name, slug, display_order)
      values (${businessId}, ${category.name}, ${category.slug}, ${index})
      on conflict (business_id, slug) do update
        set name = excluded.name,
            display_order = excluded.display_order,
            updated_at = now()
      returning id
    `;
    categoryIds.set(category.slug, row.id);
  }

  for (const [index, product] of PRODUCTS.entries()) {
    const [row] = await sql<{ id: string }[]>`
      insert into products (
        business_id, category_id, title, slug, description,
        price, stock, currency, is_available, sale_status, stars, display_order
      ) values (
        ${businessId},
        ${categoryIds.get(product.category) ?? null},
        ${product.title},
        ${product.slug},
        ${`${product.title} — producto de demostración.`},
        ${product.price},
        ${product.stock},
        ${'PEN'},
        true,
        ${product.saleStatus},
        ${product.stars},
        ${index}
      )
      on conflict (business_id, slug) do update
        set category_id = excluded.category_id,
            title = excluded.title,
            description = excluded.description,
            price = excluded.price,
            stock = excluded.stock,
            currency = excluded.currency,
            is_available = excluded.is_available,
            sale_status = excluded.sale_status,
            stars = excluded.stars,
            display_order = excluded.display_order,
            updated_at = now()
      returning id
    `;

    await sql`
      insert into product_media (product_id, media_url, media_type, display_order, alt_text)
      values (
        ${row.id},
        ${`https://picsum.photos/seed/${product.slug}/600/600`},
        ${'image'},
        0,
        ${product.title}
      )
      on conflict (product_id, display_order) do update
        set media_url = excluded.media_url,
            media_type = excluded.media_type,
            alt_text = excluded.alt_text
    `;
  }

  const [counts] = await sql<{ categories: number; products: number; media: number }[]>`
    select
      (select count(*)::int from product_categories where business_id = ${businessId}) as categories,
      (select count(*)::int from products where business_id = ${businessId}) as products,
      (select count(*)::int from product_media pm
         join products p on p.id = pm.product_id
        where p.business_id = ${businessId}) as media
  `;

  console.log(`  business ........... /${BUSINESS_SLUG}`);
  console.log(`  categories ......... ${counts.categories}`);
  console.log(`  products ........... ${counts.products}`);
  console.log(`  media rows ......... ${counts.media}`);
  console.log(`\n  Login: ${SEED_EMAIL} / ${SEED_PASSWORD}`);
  console.log(`  Storefront: http://localhost:3000/${BUSINESS_SLUG}\n`);
}

main()
  .catch((error: unknown) => {
    console.error('\n  Seed failed:', error instanceof Error ? error.message : error, '\n');
    process.exitCode = 1;
  })
  .finally(async () => {
    await sql.end({ timeout: 5 });
  });
