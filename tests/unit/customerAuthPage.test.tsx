// =====================================================
// app/auth/customer/page.tsx — emitter honors the origin allowlist (T15)
// =====================================================
// The popup is the only postMessage emitter that takes its targetOrigin from the
// `?origin` search param, and it posts access_token/refresh_token. The allowlist
// itself (isAllowedAuthReturnOrigin, url.ts) is covered in url.test.ts; what had
// NO runtime evidence was the EMIT side — that a denied origin produces no
// postMessage at all, and that an allowed one targets the validated origin
// rather than the raw param.
//
// Both cases render the DEFAULT export (page.tsx:375). CustomerAuthContent is
// not exported, so proving the emit path required no refactor of the page and
// this suite's production diff is 0 lines.
//
// The page must keep denying hostile schemes too: `new URL('javascript:…').origin`
// is the string 'null', so `javascript:alert(1)` is used here as a request
// origin — if the allowlist ever normalized it to 'null' instead of failing
// closed, this case would emit into the opener.
//
// Assertions are on the emitted message and its targetOrigin, never on markup.
// =====================================================

import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import CustomerAuthPage from '../../app/auth/customer/page';

// ── Mocks ────────────────────────────────────────────
// The suite drives the real url.ts allowlist; only the browser surface, the auth
// client and the env holder are doubles.

const { mockEnv, mockExchangeCodeForSession, mockGetSession, mockPostMessage, mockClose } =
  vi.hoisted(() => ({
    // `env.authOrigin` is read at MODULE LOAD time in src/config/env.ts:9, so a
    // late vi.stubEnv would never reach it. A mutable holder is the repo pattern
    // (requestFinalizationAuthz.test.ts:26,47).
    mockEnv: { authOrigin: '', featureSubdomainRewrite: false } as {
      authOrigin: string;
      featureSubdomainRewrite: boolean;
    },
    mockExchangeCodeForSession: vi.fn(),
    mockGetSession: vi.fn(),
    mockPostMessage: vi.fn(),
    mockClose: vi.fn(),
  }));

vi.mock('@/config/env', () => ({ env: mockEnv }));

// `page.tsx` imports the `createClient` FACTORY, not a client instance.
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      exchangeCodeForSession: mockExchangeCodeForSession,
      getSession: mockGetSession,
      signOut: vi.fn(),
      signInWithOAuth: vi.fn(),
    },
  }),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(searchParams),
}));

// ── Fixture ──────────────────────────────────────────
// `let`, not a const, so the mocked useSearchParams closes over the current value
// and each case can swap the query string without re-mocking the module.
let searchParams = '';

// eslint-disable-next-line sonarjs/code-eval -- a fixture string, never evaluated
const HOSTILE_ORIGIN = 'javascript:alert(1)';

function callbackUrl(origin: string): string {
  return `slug=acme-store&name=Acme&origin=${encodeURIComponent(origin)}&code=oauth-code-1`;
}

beforeEach(() => {
  // jsdom provides neither `window.opener` nor a spy-able `window.close`, so a
  // non-call would otherwise be indistinguishable from a missing opener.
  Object.defineProperty(window, 'opener', {
    value: { postMessage: mockPostMessage },
    configurable: true,
    writable: true,
  });
  window.close = mockClose;

  mockEnv.authOrigin = '';
  mockGetSession.mockResolvedValue({ data: { session: null } });
  mockExchangeCodeForSession.mockResolvedValue({
    data: { session: { access_token: 'access-1', refresh_token: 'refresh-1' } },
    error: null,
  });
});

afterEach(() => {
  Reflect.deleteProperty(window, 'opener');
});

describe('CustomerAuthPage — denied origin (R2)', () => {
  test.each([
    ['a foreign https origin', 'https://evil.example'],
    ['a javascript: origin', HOSTILE_ORIGIN],
  ])(
    '%s closes the popup without exchanging the code or emitting tokens',
    async (_label, origin) => {
      searchParams = callbackUrl(origin);
      // A denied origin must not reach Supabase either: no code exchange means no
      // session to leak, and no network round-trip for a hostile opener.
      render(<CustomerAuthPage />);

      await waitFor(() => expect(mockClose).toHaveBeenCalled());

      expect(mockPostMessage).not.toHaveBeenCalled();
      expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
    },
  );
});

describe('CustomerAuthPage — allowed origin (R1 + R3)', () => {
  test('emits AUTH_SUCCESS to the origin validated through the env.authOrigin clause', async () => {
    mockEnv.authOrigin = 'https://storelite.app';
    searchParams = callbackUrl('https://storelite.app');
    // In jsdom `window.location.origin` is `http://localhost:3000`, so the
    // same-origin clause cannot grant this and the env clause is the ONLY path
    // that lets the emit happen — the config grants, not the param.
    render(<CustomerAuthPage />);

    await waitFor(() => expect(mockPostMessage).toHaveBeenCalledTimes(1));

    const [payload, targetOrigin] = mockPostMessage.mock.calls[0] as [
      { type: string; slug: string; access_token: string; refresh_token: string },
      string,
    ];
    expect(targetOrigin).toBe('https://storelite.app');
    expect(payload).toEqual({
      type: 'AUTH_SUCCESS',
      slug: 'acme-store',
      access_token: 'access-1',
      refresh_token: 'refresh-1',
    });
    expect(mockClose).toHaveBeenCalled();
  });
});
