// =====================================================
// Auth return target (?redirect=) — Unit tests
// =====================================================
// The storefront gate sends logged-out visitors to
// `/auth?redirect=<original path>`. These tests pin the two
// halves of that round trip: building the callback URL the
// OAuth provider will return to, and honouring the sanitized
// target once the session exists.
//
// The handler tests call the REAL GET from app/auth/callback
// with only the Supabase/analytics edges mocked, so they fail
// if the wiring is removed — not just if a helper breaks.
// =====================================================

import { GET } from '@/app/auth/callback/route';
import { buildAuthCallbackUrl, extractRedirectFromSearch } from '@/shared/utils/redirectTarget';
import { beforeEach, describe, expect, test, vi } from 'vitest';

// ── Mocks (vi.mock is hoisted, so these live in vi.hoisted) ──

const { mockCreateClient, mockExchangeCodeForSession, mockCaptureEvent, mockSetSentryContext } =
  vi.hoisted(() => ({
    mockCreateClient: vi.fn(),
    mockExchangeCodeForSession: vi.fn(),
    mockCaptureEvent: vi.fn(),
    mockSetSentryContext: vi.fn(),
  }));

vi.mock('@/lib/supabase/server', () => ({ createClient: mockCreateClient }));
vi.mock('@/lib/analytics/capture', () => ({ captureEvent: mockCaptureEvent }));
vi.mock('@/lib/sentryContext', () => ({ setSentryContext: mockSetSentryContext }));

const CALLBACK_ORIGIN = 'https://app.storelite.test';

/** Minimal stand-in for the server Supabase client used by the handler. */
function fakeSupabaseClient(userId = 'user-1') {
  const single = vi.fn().mockResolvedValue({ data: { id: userId }, error: null });
  const selectEq = vi.fn(() => ({ single }));
  const select = vi.fn(() => ({ eq: selectEq }));
  const updateEq = vi.fn().mockResolvedValue({ error: null });
  const update = vi.fn(() => ({ eq: updateEq }));
  const insert = vi.fn().mockResolvedValue({ error: null });

  return {
    auth: { exchangeCodeForSession: mockExchangeCodeForSession },
    from: vi.fn(() => ({ select, update, insert })),
  };
}

function callbackRequest(query: string): Request {
  return new Request(`${CALLBACK_ORIGIN}/auth/callback?${query}`);
}

function locationOf(response: Response): string {
  return response.headers.get('location') ?? '';
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateClient.mockResolvedValue(fakeSupabaseClient());
  mockCaptureEvent.mockResolvedValue(undefined);
  mockExchangeCodeForSession.mockResolvedValue({
    data: { user: { id: 'user-1', email: 'seller@example.com', user_metadata: {} } },
    error: null,
  });
});

// ── buildAuthCallbackUrl ──────────────────────────────────────────────

describe('buildAuthCallbackUrl — the URL handed to the OAuth provider', () => {
  test('returns the plain callback URL when no return target is carried', () => {
    expect(buildAuthCallbackUrl(CALLBACK_ORIGIN, null)).toBe(`${CALLBACK_ORIGIN}/auth/callback`);
  });

  test('carries a valid return target, percent-encoded', () => {
    expect(buildAuthCallbackUrl(CALLBACK_ORIGIN, '/tienda/dashboard')).toBe(
      `${CALLBACK_ORIGIN}/auth/callback?redirect=%2Ftienda%2Fdashboard`,
    );
  });

  test('encodes a return target that carries its own query string', () => {
    const url = buildAuthCallbackUrl(CALLBACK_ORIGIN, '/tienda/settings?tab=team');

    expect(url).toBe(`${CALLBACK_ORIGIN}/auth/callback?redirect=%2Ftienda%2Fsettings%3Ftab%3Dteam`);
    // The value must survive one decode as a single param, not leak a second `?`.
    expect(new URL(url).searchParams.get('redirect')).toBe('/tienda/settings?tab=team');
  });

  test('keeps an encoded-but-legitimate target intact', () => {
    expect(buildAuthCallbackUrl(CALLBACK_ORIGIN, '/tienda/product/a%20b')).toBe(
      `${CALLBACK_ORIGIN}/auth/callback?redirect=%2Ftienda%2Fproduct%2Fa%2520b`,
    );
  });

  test.each([
    ['protocol-relative', '//evil.example.com'],
    ['backslash-relative', '/\\evil.example.com'],
    ['absolute', 'https://evil.example.com'],
    ['encoded protocol-relative', '/%2f%2fevil.example.com'],
    ['encoded backslash-relative', '/%5c%5cevil.example.com'],
    ['scheme smuggling', '/javascript:alert(1)'],
    ['malformed percent sequence', '/%zz'],
    ['login route (loop)', '/auth'],
    ['login sub-route (loop)', '/auth/callback'],
    ['login route in another casing (loop)', '/AUTH'],
    ['control characters', '/tienda/\u0000dashboard'],
    ['oversized', `/${'a'.repeat(600)}`],
  ])('falls back to the plain callback URL for a %s target', (_label, hostile) => {
    expect(buildAuthCallbackUrl(CALLBACK_ORIGIN, hostile)).toBe(`${CALLBACK_ORIGIN}/auth/callback`);
  });

  test('never returns null: a hostile target must not be able to break sign-in', () => {
    // A null here would let one crafted ?redirect= value kill the login flow.
    expect(typeof buildAuthCallbackUrl(CALLBACK_ORIGIN, '//evil.example.com')).toBe('string');
  });
});

// ── extractRedirectFromSearch ─────────────────────────────────────────

describe('extractRedirectFromSearch — reading the param off the current location', () => {
  test('returns the decoded target from a search string', () => {
    expect(extractRedirectFromSearch('?redirect=%2Ftienda%2Fdashboard')).toBe('/tienda/dashboard');
  });

  test('returns the target even when other params come first', () => {
    expect(extractRedirectFromSearch('?error=x&redirect=%2Ftienda%2Fsettings')).toBe(
      '/tienda/settings',
    );
  });

  test('returns null when the param is absent', () => {
    expect(extractRedirectFromSearch('?foo=bar')).toBeNull();
  });

  test('returns null for an empty search string', () => {
    expect(extractRedirectFromSearch('')).toBeNull();
  });

  test('returns null when the param is present but empty', () => {
    expect(extractRedirectFromSearch('?redirect=')).toBeNull();
  });
});

// ── GET /auth/callback — the wiring ───────────────────────────────────

describe('GET /auth/callback — honouring the return target', () => {
  test('redirects to the sanitized target after a successful exchange', async () => {
    const response = await GET(callbackRequest('code=abc&redirect=%2Ftienda%2Fdashboard'));

    expect(locationOf(response)).toBe(`${CALLBACK_ORIGIN}/tienda/dashboard`);
  });

  test('preserves the query string of the return target', async () => {
    const response = await GET(
      callbackRequest('code=abc&redirect=%2Ftienda%2Fsettings%3Ftab%3Dteam'),
    );

    expect(locationOf(response)).toBe(`${CALLBACK_ORIGIN}/tienda/settings?tab=team`);
  });

  test('re-sanitizes server-side: a hostile target never reaches the Location header', async () => {
    const response = await GET(callbackRequest('code=abc&redirect=%2F%2Fevil.example.com%2Fsteal'));

    const location = locationOf(response);
    expect(location).toBe(`${CALLBACK_ORIGIN}/onboarding`);
    expect(location).not.toContain('evil.example.com');
  });

  test('re-sanitizes server-side: a target pointing back at login falls back', async () => {
    const response = await GET(callbackRequest('code=abc&redirect=%2Fauth'));

    expect(locationOf(response)).toBe(`${CALLBACK_ORIGIN}/onboarding`);
  });

  test('keeps /onboarding when no return target is carried', async () => {
    const response = await GET(callbackRequest('code=abc'));

    expect(locationOf(response)).toBe(`${CALLBACK_ORIGIN}/onboarding`);
  });

  test('keeps the chat intent branch winning over a return target', async () => {
    const response = await GET(
      callbackRequest('code=abc&chat=true&slug=tienda-uno&redirect=%2Ftienda-uno%2Fdashboard'),
    );

    expect(locationOf(response)).toBe(`${CALLBACK_ORIGIN}/tienda-uno?chat_ready=true`);
  });

  test('an exchange failure keeps both the error signal and the return target', async () => {
    mockExchangeCodeForSession.mockResolvedValue({ data: { user: null }, error: { message: 'x' } });

    const response = await GET(callbackRequest('code=abc&redirect=%2Ftienda%2Fdashboard'));

    // Without this, a transient failure followed by a retry would silently
    // drop the deep link the user originally clicked.
    expect(locationOf(response)).toBe(
      `${CALLBACK_ORIGIN}/auth?error=exchange_failed&redirect=%2Ftienda%2Fdashboard`,
    );
  });

  test('an exchange failure drops a hostile return target', async () => {
    mockExchangeCodeForSession.mockResolvedValue({ data: { user: null }, error: { message: 'x' } });

    const response = await GET(callbackRequest('code=abc&redirect=%2F%2Fevil.example.com'));

    expect(locationOf(response)).toBe(`${CALLBACK_ORIGIN}/auth?error=exchange_failed`);
  });

  test('a missing code sends the user back to login and keeps the return target', async () => {
    const response = await GET(callbackRequest('redirect=%2Ftienda%2Fdashboard'));

    expect(locationOf(response)).toBe(`${CALLBACK_ORIGIN}/auth?redirect=%2Ftienda%2Fdashboard`);
    expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
  });

  test('a double-encoded protocol-relative target never reaches the Location header', async () => {
    // searchParams.get decodes once → "/%2f%2fevil.example.com"; the sanitizer
    // must reject it by validating the form it decodes ITSELF.
    const response = await GET(callbackRequest('code=abc&redirect=%2F%252f%252fevil.example.com'));

    const location = locationOf(response);
    expect(location).toBe(`${CALLBACK_ORIGIN}/onboarding`);
    expect(location).not.toContain('evil.example.com');
  });

  test('an encoded-slash login target never reaches the Location header', async () => {
    // searchParams.get decodes once → "/Auth%2Fcallback", which only the
    // decoded-form loop guard catches.
    const response = await GET(callbackRequest('code=abc&redirect=%2FAuth%252Fcallback'));

    expect(locationOf(response)).toBe(`${CALLBACK_ORIGIN}/onboarding`);
  });
});
