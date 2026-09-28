import { beforeEach, describe, expect, test, vi } from 'vitest';

// =====================================================
// GET /api/billing/sunat-report — platform admin gate
// =====================================================
// The export is cross-tenant by design, so authorization is the ONLY control:
//   1. a valid `x-sass-key` authorizes alone, WITHOUT a session (parity with
//      app/api/sass/notifications/broadcast/route.ts — spec R2/R3), and
//   2. otherwise the caller must be listed in `PLATFORM_ADMIN_IDS` (spec R1).
// The gate runs before any `planPayments` read, and the existing 400 for a
// missing month/year stays AFTER the gate (spec R2).
//
// `@/features/storage/actions/authz` is mocked (repo convention — see
// penaltiesRoute.test.ts) so the suite asserts what this route adds. `@/config/env`
// is NOT mocked: `env` is a module-scope literal, so each case stubs the process
// env and re-imports the route (repo pattern — env.test.ts, url.test.ts). The
// `PLATFORM_ADMIN_IDS` parsing itself is covered by its own describe below.
// `db.query.planPayments.findMany` is the observable "did we reach the database"
// probe.

const { mockRequireAuthenticatedUserId, mockFindMany } = vi.hoisted(() => ({
  mockRequireAuthenticatedUserId: vi.fn(),
  mockFindMany: vi.fn(),
}));

vi.mock('@/features/storage/actions/authz', () => ({
  requireAuthenticatedUserId: mockRequireAuthenticatedUserId,
}));

vi.mock('@/core/database/client', () => ({
  db: { query: { planPayments: { findMany: mockFindMany } } },
}));

// ── Fixtures ─────────────────────────────────────────

const OPERATOR_ID = 'user_ops_1';
const TENANT_USER_ID = 'user_tenant_9';
const SASS_API_KEY = 'sass-secret-value';
const MONTH_YEAR = '?month=04&year=2026';

const PAYMENTS = [
  {
    ticketIssuedAt: new Date('2026-04-03T10:15:00.000Z'),
    ticketSeries: 'F001',
    ticketCorrelative: 42,
    buyerDocumentType: 'DNI',
    buyerDocumentNumber: '45678912',
    buyerFullName: 'Ana Quispe',
    amountSubtotal: '100.00',
    amountIgv: '18.00',
    amountTotal: '118.00',
    currency: 'PEN',
    status: 'issued',
    business: { owner: { fullName: 'Dueño de la Tienda' } },
  },
  {
    // No buyer name on file → the row must fall back to the business owner name.
    ticketIssuedAt: new Date('2026-04-20T08:00:00.000Z'),
    ticketSeries: 'F001',
    ticketCorrelative: 7,
    buyerDocumentType: null,
    buyerDocumentNumber: null,
    buyerFullName: null,
    amountSubtotal: '50.00',
    amountIgv: '9.00',
    amountTotal: '59.00',
    currency: 'PEN',
    status: 'issued',
    business: { owner: { fullName: 'Dueño de la Tienda' } },
  },
];

const CSV_HEADER =
  'Fecha,Serie-Correlativo,Tipo Doc,Nro Doc,Cliente,Subtotal,IGV,Total,Moneda,Estado';
const CSV_ROW_1 = '2026-04-03,F001-00000042,DNI,45678912,Ana Quispe,100.00,18.00,118.00,PEN,issued';
const CSV_ROW_2 = '2026-04-20,F001-00000007,DNI,-,Dueño de la Tienda,50.00,9.00,59.00,PEN,issued';

// ── Helpers ──────────────────────────────────────────

/** Authz refuses: mirrors the real `No autorizado` throw from `authz.ts`. */
function refuseSession() {
  mockRequireAuthenticatedUserId.mockRejectedValue(new Error('No autorizado'));
}

function signInAs(userId: string) {
  mockRequireAuthenticatedUserId.mockResolvedValue(userId);
}

interface SunatRequestOptions {
  search?: string;
  /** `undefined` omits the header entirely; `''` sends an empty header. */
  sassKey?: string;
}

function sunatRequest({ search = MONTH_YEAR, sassKey }: SunatRequestOptions = {}): Request {
  return new Request(`http://localhost/api/billing/sunat-report${search}`, {
    headers: sassKey === undefined ? undefined : { 'x-sass-key': sassKey },
  });
}

/** Re-evaluates `@/config/env` against the currently stubbed process env. */
async function loadGet() {
  vi.resetModules();
  const { GET } = await import('@/app/api/billing/sunat-report/route');
  return GET;
}

async function expectUnauthorized(res: Response) {
  expect(res.status).toBe(401);
  expect((await res.json()).error).toBe('No autorizado');
  expect(mockFindMany).not.toHaveBeenCalled();
}

// ── Suite ────────────────────────────────────────────

describe('GET /api/billing/sunat-report — platform admin gate', () => {
  beforeEach(() => {
    mockFindMany.mockReset();
    mockFindMany.mockResolvedValue(PAYMENTS);
    mockRequireAuthenticatedUserId.mockReset();
    vi.stubEnv('PLATFORM_ADMIN_IDS', '');
    vi.stubEnv('SASS_API_KEY', '');
  });

  test('401 for an anonymous caller with no service key, without reading billing rows', async () => {
    vi.stubEnv('PLATFORM_ADMIN_IDS', OPERATOR_ID);
    vi.stubEnv('SASS_API_KEY', SASS_API_KEY);
    refuseSession();
    const GET = await loadGet();

    const res = await GET(sunatRequest());

    await expectUnauthorized(res);
    expect(mockRequireAuthenticatedUserId).toHaveBeenCalledTimes(1);
  });

  test('401 for an authenticated user that is not allowlisted, without reading billing rows', async () => {
    vi.stubEnv('PLATFORM_ADMIN_IDS', OPERATOR_ID);
    vi.stubEnv('SASS_API_KEY', SASS_API_KEY);
    signInAs(TENANT_USER_ID);
    const GET = await loadGet();

    const res = await GET(sunatRequest());

    await expectUnauthorized(res);
    // The resolved id must be captured and checked against the allowlist.
    expect(mockRequireAuthenticatedUserId).toHaveBeenCalledTimes(1);
  });

  test('200 with the cross-tenant CSV for an allowlisted operator', async () => {
    vi.stubEnv('PLATFORM_ADMIN_IDS', ` ${OPERATOR_ID} `);
    vi.stubEnv('SASS_API_KEY', SASS_API_KEY);
    signInAs(OPERATOR_ID);
    const GET = await loadGet();

    const res = await GET(sunatRequest());

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/csv');
    expect(res.headers.get('content-disposition')).toBe(
      'attachment; filename="boletas-saas-2026-04.csv"',
    );
    const csv = await res.text();
    expect(csv.split('\n')).toEqual([CSV_HEADER, CSV_ROW_1, CSV_ROW_2]);
    expect(mockFindMany).toHaveBeenCalledTimes(1);
  });

  test('200 with a valid service key and NO session at all', async () => {
    vi.stubEnv('PLATFORM_ADMIN_IDS', '');
    vi.stubEnv('SASS_API_KEY', SASS_API_KEY);
    refuseSession();
    const GET = await loadGet();

    const res = await GET(sunatRequest({ sassKey: SASS_API_KEY }));

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/csv');
    expect(await res.text()).toContain(CSV_ROW_1);
    // The key authorizes alone: the session must not even be consulted.
    expect(mockRequireAuthenticatedUserId).not.toHaveBeenCalled();
    expect(mockFindMany).toHaveBeenCalledTimes(1);
  });

  test('401 for a wrong service key on a caller that is not allowlisted', async () => {
    vi.stubEnv('PLATFORM_ADMIN_IDS', OPERATOR_ID);
    vi.stubEnv('SASS_API_KEY', SASS_API_KEY);
    signInAs(TENANT_USER_ID);
    const GET = await loadGet();

    const res = await GET(sunatRequest({ sassKey: 'not-the-key' }));

    await expectUnauthorized(res);
  });

  test('401 when SASS_API_KEY is unset and the header is empty, never empty-vs-empty', async () => {
    vi.stubEnv('PLATFORM_ADMIN_IDS', '');
    vi.stubEnv('SASS_API_KEY', '');
    signInAs(TENANT_USER_ID);
    const GET = await loadGet();

    const res = await GET(sunatRequest({ sassKey: '' }));

    await expectUnauthorized(res);
  });

  test('400 for an authorized operator when month/year are missing, without querying', async () => {
    vi.stubEnv('PLATFORM_ADMIN_IDS', OPERATOR_ID);
    vi.stubEnv('SASS_API_KEY', SASS_API_KEY);
    signInAs(OPERATOR_ID);
    const GET = await loadGet();

    const res = await GET(sunatRequest({ search: '' }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Faltan parámetros de mes (1-12) y año (YYYY)');
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  test('401 — not 400 — when month/year are missing and the caller is not allowlisted', async () => {
    vi.stubEnv('PLATFORM_ADMIN_IDS', OPERATOR_ID);
    vi.stubEnv('SASS_API_KEY', SASS_API_KEY);
    signInAs(TENANT_USER_ID);
    const GET = await loadGet();

    const res = await GET(sunatRequest({ search: '' }));

    // The parameter validation must stay AFTER the gate, otherwise the 400 leaks
    // route internals to callers that are not authorized to use this route.
    await expectUnauthorized(res);
  });
});

// ── Config surface (spec R1) ─────────────────────────

describe('env — PLATFORM_ADMIN_IDS parsing', () => {
  test('trims each entry and drops blanks', async () => {
    vi.stubEnv('PLATFORM_ADMIN_IDS', ' id-a , ,id-b ');
    vi.resetModules();

    const { env } = await import('@/config/env');

    expect(env.platformAdminIds).toEqual(['id-a', 'id-b']);
  });

  test('resolves to an empty list when the variable is unset (fail-closed)', async () => {
    delete process.env.PLATFORM_ADMIN_IDS;
    vi.resetModules();

    const { env } = await import('@/config/env');

    expect(env.platformAdminIds).toEqual([]);
  });
});
