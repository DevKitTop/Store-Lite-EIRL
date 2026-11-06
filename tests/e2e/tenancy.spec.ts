import { expect, test, type Browser, type BrowserContext } from '@playwright/test';
import 'dotenv/config';

/**
 * Tenant isolation across real HTTP, not PostgREST.
 *
 * The RLS checks in `scripts/tenancy-check.ts` cover the REST surface, but the
 * application's own server code connects as the postgres superuser and is not
 * subject to RLS. So the pages a merchant actually loads need their own proof.
 *
 * Sessions are injected as the Supabase SSR cookie rather than driven through
 * the login form: the form is the thing under test elsewhere, and a flaky
 * login would make an isolation failure indistinguishable from a UI failure.
 *
 * Fixtures come from `pnpm check:tenancy` (tenants `tenancy-a` / `tenancy-b`).
 * Their `description` carries a marker; if it appears while browsing as the
 * other tenant, isolation is broken.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

// Fixture account created by "pnpm check:tenancy" against a local database.
// Not a credential: it grants access to two synthetic tenants and nothing else.
// sonarjs/no-hardcoded-passwords is about real secrets, not test fixtures.
// eslint-disable-next-line sonarjs/no-hardcoded-passwords
const TENANT_A = { email: 'tenancy-a@storelite.test', password: 'TenancyA123!' };
const OWN_SLUG = 'tenancy-a';
const FOREIGN_SLUG = 'tenancy-b';
const FOREIGN_MARKER = `private-marker-${FOREIGN_SLUG}`;

function chunk(value: string, size: number): string[] {
  const parts: string[] = [];
  for (let index = 0; index < value.length; index += size) {
    parts.push(value.slice(index, index + size));
  }
  return parts;
}

async function sessionCookies(): Promise<
  { name: string; value: string; domain: string; path: string }[]
> {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(TENANT_A),
  });

  if (!response.ok) {
    throw new Error(
      `Could not sign in as ${TENANT_A.email} (HTTP ${response.status}). Run "pnpm check:tenancy" to create the fixtures.`,
    );
  }

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
  const storageKey = `sb-${new URL(SUPABASE_URL).hostname.split('.')[0]}-auth-token`;
  const parts = chunk(encoded, 3180);

  return parts.map((value, index) => {
    const suffix = parts.length > 1 ? `.${index}` : '';
    return { name: storageKey + suffix, value, domain: 'localhost', path: '/' };
  });
}

async function contextAsTenantA(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext();
  await context.addCookies(await sessionCookies());
  return context;
}

// Opt-in, because the fixtures live in a database the CI runner does not have
// and a suite that fails for an environment reason teaches people to ignore it.
const TENANCY_E2E_ENABLED = process.env.TENANCY_E2E === '1';

test.describe('tenant isolation over HTTP', () => {
  test.skip(
    !TENANCY_E2E_ENABLED,
    'Set TENANCY_E2E=1 and run "pnpm check:tenancy" first to create the fixtures.',
  );

  test('anonymous visitor is sent away from a private page', async ({ browser }) => {
    const context = await browser.newContext();
    const response = await context.request.get(`/${OWN_SLUG}/dashboard`, { maxRedirects: 0 });

    // Next answers 302 here; other builds use 307/308. What matters is that it
    // is a redirect and it does not point back at the dashboard.
    expect([302, 307, 308]).toContain(response.status());
    expect(response.headers().location ?? '').not.toContain('/dashboard');
    await context.close();
  });

  test('owner reaches their own dashboard', async ({ browser }) => {
    const context = await contextAsTenantA(browser);
    const response = await context.request.get(`/${OWN_SLUG}/dashboard`, { maxRedirects: 0 });

    expect(response.status()).toBe(200);
    await context.close();
  });

  test('owner is redirected away from another tenant dashboard', async ({ browser }) => {
    const context = await contextAsTenantA(browser);
    const response = await context.request.get(`/${FOREIGN_SLUG}/dashboard`, { maxRedirects: 0 });

    expect([307, 308]).toContain(response.status());
    expect(await response.text()).not.toContain(FOREIGN_MARKER);
    await context.close();
  });

  for (const page of ['settings', 'storage']) {
    test(`owner cannot open another tenant ${page}`, async ({ browser }) => {
      const context = await contextAsTenantA(browser);
      const response = await context.request.get(`/${FOREIGN_SLUG}/${page}`, {
        maxRedirects: 0,
      });

      expect(response.status()).toBe(404);
      expect(await response.text()).not.toContain(FOREIGN_MARKER);
      await context.close();
    });
  }
});
