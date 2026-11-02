/**
 * Multi-tenant isolation check.
 *
 * Asserts, against a live Supabase instance, that a signed-in merchant cannot
 * read or modify another merchant's data. This is the class of bug no static
 * analyzer can find: a technically valid query against the wrong tenant.
 *
 * Runs are read-only from the API's point of view: the two "attack" cases try
 * to modify foreign rows and then verify, as service_role, that nothing
 * changed. Setup writes two dedicated tenants (`tenancy-a`, `tenancy-b`) and is
 * idempotent.
 *
 * Local only. Same reasoning as the seed: this creates users and rows, and
 * there is no version of that which should run against production.
 *
 * Usage: pnpm check:tenancy
 */
import 'dotenv/config';
import postgres from 'postgres';

const TENANT_A = {
  email: 'tenancy-a@storelite.test',
  password: 'TenancyA123!',
  slug: 'tenancy-a',
  name: 'Tenancy A',
  productSlug: 'tenancy-a-product',
  orderNumber: 'TENANCY-A-001',
  trackingToken: 'tenancy-a-token-001',
};

const TENANT_B = {
  email: 'tenancy-b@storelite.test',
  password: 'TenancyB123!',
  slug: 'tenancy-b',
  name: 'Tenancy B',
  productSlug: 'tenancy-b-product',
  orderNumber: 'TENANCY-B-001',
  trackingToken: 'tenancy-b-token-001',
};

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

function abort(message: string): never {
  console.error(`\n  ABORT: ${message}\n  Nothing was checked.\n`);
  process.exit(1);
}

function hostOf(value: string | undefined, label: string): string {
  if (!value) abort(`${label} is not set.`);
  try {
    return new URL(value).hostname;
  } catch {
    abort(`${label} is not a valid URL.`);
  }
}

if (process.env.NODE_ENV === 'production') {
  abort('Refusing to run while NODE_ENV=production.');
}

const databaseHost = hostOf(process.env.DATABASE_URL, 'DATABASE_URL');
const supabaseHost = hostOf(process.env.NEXT_PUBLIC_SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL');

if (!LOCAL_HOSTS.has(databaseHost) || !LOCAL_HOSTS.has(supabaseHost)) {
  abort(
    `This check writes fixture tenants and only targets local Supabase. Got ${databaseHost} / ${supabaseHost}.`,
  );
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!serviceRoleKey) abort('SUPABASE_SERVICE_ROLE_KEY is not set.');
if (!anonKey) abort('NEXT_PUBLIC_SUPABASE_ANON_KEY is not set.');

const sql = postgres(process.env.DATABASE_URL as string, { max: 1, connect_timeout: 10 });

interface Fixture {
  userId: string;
  businessId: string;
  productId: string;
  paymentId: string;
}

async function ensureUser(email: string, password: string): Promise<string> {
  const list = await fetch(`${supabaseUrl}/auth/v1/admin/users?page=1&per_page=200`, {
    headers: { apikey: serviceRoleKey as string, Authorization: `Bearer ${serviceRoleKey}` },
  });

  if (list.ok) {
    const payload = (await list.json()) as { users?: { id: string; email?: string }[] };
    const existing = payload.users?.find((user) => user.email === email);
    if (existing?.id) return existing.id;
  }

  const created = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: serviceRoleKey as string,
      Authorization: `Bearer ${serviceRoleKey as string}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });

  if (!created.ok) abort(`Could not create ${email} (HTTP ${created.status}).`);
  const body = (await created.json()) as { id?: string };
  if (!body.id) abort(`Admin API returned no id for ${email}.`);
  return body.id;
}

async function ensureFixture(tenant: typeof TENANT_A): Promise<Fixture> {
  const userId = await ensureUser(tenant.email, tenant.password);

  await sql`
    insert into profiles (id, email, full_name)
    values (${userId}, ${tenant.email}, ${tenant.name})
    on conflict (id) do update set email = excluded.email, updated_at = now()
  `;

  // `description` carries a marker the E2E spec looks for. If it ever shows up
  // while browsing as another tenant, isolation is broken. It is fixture data,
  // not a secret: its only job is to be greppable.
  const [business] = await sql<{ id: string }[]>`
    insert into businesses (owner_id, name, slug, description, city, country, is_active, verification_status)
    values (
      ${userId}, ${tenant.name}, ${tenant.slug},
      ${`private-marker-${tenant.slug}`},
      ${'Lima'}, ${'PE'}, true, ${'verified'}
    )
    on conflict (slug) do update
      set owner_id = excluded.owner_id,
          description = excluded.description,
          updated_at = now()
    returning id
  `;

  const [product] = await sql<{ id: string }[]>`
    insert into products (business_id, title, slug, description, price, currency, is_available, stock)
    values (${business.id}, ${`${tenant.name} product`}, ${tenant.productSlug}, ${'fixture'}, ${'10.00'}, ${'PEN'}, true, 5)
    on conflict (business_id, slug) do update set updated_at = now()
    returning id
  `;

  const [payment] = await sql<{ id: string }[]>`
    insert into payments (
      business_id, product_id, seller_user_id, amount, currency, payment_method,
      buyer_email, status, order_number, tracking_token, version
    ) values (
      ${business.id}, ${product.id}, ${userId}, ${'10.00'}, ${'PEN'}, ${'yape'},
      ${`buyer-${tenant.slug}@storelite.test`}, ${'pending'},
      ${tenant.orderNumber}, ${tenant.trackingToken}, 1
    )
    on conflict (tracking_token) do update set updated_at = now()
    returning id
  `;

  return {
    userId,
    businessId: business.id,
    productId: product.id,
    paymentId: payment.id,
  };
}

async function signIn(email: string, password: string): Promise<string> {
  const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: anonKey as string,
      Authorization: `Bearer ${anonKey as string}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) abort(`Sign-in failed for ${email} (HTTP ${response.status}).`);
  const body = (await response.json()) as { access_token?: string };
  if (!body.access_token) abort(`No access token for ${email}.`);
  return body.access_token;
}

interface RestOptions {
  token: string;
  method?: string;
  body?: unknown;
}

async function rest(
  path: string,
  options: RestOptions,
): Promise<{ status: number; rows: unknown[] }> {
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    method: options.method ?? 'GET',
    headers: {
      apikey: anonKey as string,
      Authorization: `Bearer ${options.token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const text = await response.text();
  let rows: unknown[] = [];
  if (text) {
    try {
      const parsed = JSON.parse(text);
      rows = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      rows = [];
    }
  }

  return { status: response.status, rows };
}

/**
 * Builds the Supabase SSR session cookie the app expects.
 *
 * Route Handlers read the session from cookies (`sb-<ref>-auth-token`), not from
 * an Authorization header, so exercising them as a specific tenant means
 * reproducing that cookie: `base64-` prefix, base64url payload, chunked at
 * 3180 bytes. Verified against the running app: a wrong cookie yields 401, the
 * right one returns that user's permissions.
 */
async function buildSessionCookie(email: string, password: string): Promise<string> {
  const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: anonKey as string,
      Authorization: `Bearer ${anonKey as string}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) abort(`Could not build a session cookie for ${email}.`);
  const session = (await response.json()) as Record<string, unknown>;

  const payload = JSON.stringify({
    access_token: session.access_token,
    token_type: session.token_type,
    expires_in: session.expires_in,
    expires_at: session.expires_at,
    refresh_token: session.refresh_token,
    user: session.user,
  });

  const encoded = `base64-${Buffer.from(payload, 'utf8').toString('base64url')}`;
  const storageKey = `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;

  const chunks: string[] = [];
  for (let index = 0; index < encoded.length; index += 3180) {
    chunks.push(encoded.slice(index, index + 3180));
  }

  return chunks
    .map((chunk, index) => `${storageKey}${chunks.length > 1 ? `.${index}` : ''}=${chunk}`)
    .join('; ');
}

async function appIsReachable(base: string): Promise<boolean> {
  try {
    const response = await fetch(base, { signal: AbortSignal.timeout(5000) });
    return response.status < 500;
  } catch {
    return false;
  }
}

const results: { name: string; ok: boolean; detail: string }[] = [];

function expect(name: string, ok: boolean, detail: string): void {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function main(): Promise<void> {
  console.log(`\nTenancy isolation check against ${databaseHost}\n`);

  const a = await ensureFixture(TENANT_A);
  const b = await ensureFixture(TENANT_B);

  const tokenA = await signIn(TENANT_A.email, TENANT_A.password);

  // 1. Anonymous sees nothing.
  const anonBusinesses = await rest(`businesses?select=id,slug&slug=eq.${TENANT_B.slug}`, {
    token: anonKey as string,
  });
  expect(
    'anon cannot list any business',
    anonBusinesses.status === 200 && anonBusinesses.rows.length === 0,
    `status ${anonBusinesses.status}, ${anonBusinesses.rows.length} rows`,
  );

  // 2. Owner sees their own tenant.
  const ownBusiness = await rest(`businesses?select=id,slug&slug=eq.${TENANT_A.slug}`, {
    token: tokenA,
  });
  expect(
    'owner reads their own business',
    ownBusiness.rows.length === 1,
    `${ownBusiness.rows.length} rows`,
  );

  // 3. Owner cannot see the other tenant.
  const foreignBusiness = await rest(`businesses?select=id,slug&slug=eq.${TENANT_B.slug}`, {
    token: tokenA,
  });
  expect(
    'owner cannot read another business',
    foreignBusiness.status === 200 && foreignBusiness.rows.length === 0,
    `status ${foreignBusiness.status}, ${foreignBusiness.rows.length} rows`,
  );

  // 4. Owner cannot read another tenant's payments.
  const foreignPayments = await rest(`payments?select=id&business_id=eq.${b.businessId}`, {
    token: tokenA,
  });
  expect(
    'owner cannot read another business payments',
    foreignPayments.status === 200 && foreignPayments.rows.length === 0,
    `status ${foreignPayments.status}, ${foreignPayments.rows.length} rows`,
  );

  // 5. Owner's payment listing never contains foreign rows.
  const ownPayments = await rest('payments?select=id,business_id', { token: tokenA });
  const foreignInOwnList = (ownPayments.rows as { business_id: string }[]).filter(
    (row) => row.business_id !== a.businessId,
  );
  expect(
    'payment listing contains only own rows',
    foreignInOwnList.length === 0,
    `${ownPayments.rows.length} rows, ${foreignInOwnList.length} foreign`,
  );

  // 6. Owner cannot rename another business. The status assertion matters: a
  // rejected token would also leave the row untouched, which would look like a
  // pass for the wrong reason.
  const updateAttempt = await rest(`businesses?id=eq.${b.businessId}`, {
    token: tokenA,
    method: 'PATCH',
    body: { name: 'hijacked-by-tenancy-test' },
  });
  const [businessAfter] = await sql<{ name: string }[]>`
    select name from businesses where id = ${b.businessId}
  `;
  expect(
    'owner cannot update another business',
    updateAttempt.status < 400 && businessAfter.name === TENANT_B.name,
    `status ${updateAttempt.status}, name is "${businessAfter.name}"`,
  );

  // 7. Owner cannot delete another tenant's payment.
  const deleteAttempt = await rest(`payments?id=eq.${b.paymentId}`, {
    token: tokenA,
    method: 'DELETE',
  });
  const [paymentAfter] = await sql<{ id: string }[]>`
    select id from payments where id = ${b.paymentId}
  `;
  expect(
    'owner cannot delete another business payment',
    deleteAttempt.status < 400 && Boolean(paymentAfter?.id),
    `status ${deleteAttempt.status}, ${paymentAfter?.id ? 'row still present' : 'row was deleted'}`,
  );

  // 8. Control: service_role sees both, so the checks above are not vacuously true.
  const serviceView = await rest(
    `businesses?select=id,slug&slug=in.(${TENANT_A.slug},${TENANT_B.slug})`,
    { token: serviceRoleKey as string },
  );
  expect(
    'control: service_role sees both tenants',
    serviceView.rows.length === 2,
    `${serviceView.rows.length} rows`,
  );

  // Route Handler checks. They need the app running; without it they are
  // reported as SKIP rather than FAIL, because an environment problem is not a
  // security result.
  const appUrl = process.env.TENANCY_APP_URL ?? 'http://localhost:3000';

  if (!(await appIsReachable(appUrl))) {
    console.log(`  SKIP  Route Handler checks — app not reachable at ${appUrl}`);
  } else {
    const cookie = await buildSessionCookie(TENANT_A.email, TENANT_A.password);

    const permissions = await fetch(
      `${appUrl}/api/business/permissions?businessId=${b.businessId}`,
      { headers: { Cookie: cookie } },
    );
    const permissionsBody = (await permissions.json()) as {
      isOwner?: boolean;
      permissions?: unknown[];
      business?: { name?: string; slug?: string };
    };
    expect(
      'API: foreign business grants no ownership or permissions',
      permissions.status === 200 &&
        permissionsBody.isOwner === false &&
        Array.isArray(permissionsBody.permissions) &&
        permissionsBody.permissions.length === 0,
      `status ${permissions.status}, isOwner=${String(permissionsBody.isOwner)}`,
    );

    const penalty = await fetch(
      `${appUrl}/api/business/penalty-status?businessId=${b.businessId}`,
      { headers: { Cookie: cookie } },
    );
    const penaltyText = await penalty.text();
    expect(
      'API: penalty status hides owner-only fields',
      penalty.status === 200 && !/penaltyDebt|penaltyCount/.test(penaltyText),
      /penaltyDebt|penaltyCount/.test(penaltyText) ? 'owner fields leaked' : 'public fields only',
    );

    if (permissionsBody.business?.slug) {
      console.log(
        `  WARN  /api/business/permissions echoes a foreign business identity to a non-member (slug "${permissionsBody.business.slug}")`,
      );
    }
  }

  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed\n`);
  if (failed.length > 0) process.exitCode = 1;
}

main()
  .catch((error: unknown) => {
    console.error(
      '\n  Tenancy check failed:',
      error instanceof Error ? error.message : error,
      '\n',
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await sql.end({ timeout: 5 });
  });
