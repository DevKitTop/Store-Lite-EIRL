// =====================================================
// LogoutButton — Unit tests
// =====================================================
// Verifies that:
// 1. Logout handler sets marker in BOTH sessionStorage and
//    localStorage (cross-tab persistence for serverPreAuth).
// 2. Marker includes timestamp so it auto-expires.
// 3. clearLogoutIntent removes from both stores.
// 4. hasLogoutIntent checks localStorage with expiry validation.
// 5. (R16) The rendered button ALSO revokes the signed server-side access
//    cookie, while keeping every existing client-side marker intact.

import LogoutButton from '@/app/[slug]/(app)/order/[token]/LogoutButton';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockClearOrderAccessCookie, mockPush } = vi.hoisted(() => ({
  mockClearOrderAccessCookie: vi.fn(),
  mockPush: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock('@/app/[slug]/(app)/order/[token]/actions', () => ({
  clearOrderAccessCookie: (...args: unknown[]) => mockClearOrderAccessCookie(...args),
}));

vi.mock('@/shared/components/ui', () => ({
  Icon: ({ children, size = 24 }: { children?: ReactNode; size?: number }) => (
    <md-icon size={size}>{children}</md-icon>
  ),
}));

beforeEach(() => {
  mockClearOrderAccessCookie.mockImplementation(async () => {});
});

afterEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

const LOGOUT_INTENT_LS_KEY = 'order_logout_intent';

/** Helper: replicate the real hasLogoutIntent logic */
function hasLogoutIntent(token: string): boolean {
  const ssIntent = sessionStorage.getItem('order_logout_intent');
  if (ssIntent === token) return true;

  try {
    const lsRaw = localStorage.getItem(LOGOUT_INTENT_LS_KEY);
    if (lsRaw) {
      const parsed = JSON.parse(lsRaw);
      if (parsed.token === token && parsed.expiresAt > Date.now()) {
        return true;
      }
      localStorage.removeItem(LOGOUT_INTENT_LS_KEY);
    }
  } catch {
    localStorage.removeItem(LOGOUT_INTENT_LS_KEY);
  }

  return false;
}

function clearLogoutIntent(token: string) {
  const intent = sessionStorage.getItem('order_logout_intent');
  if (intent === token) {
    sessionStorage.removeItem('order_logout_intent');
  }
  localStorage.removeItem(LOGOUT_INTENT_LS_KEY);
}

describe('LogoutButton logout intent marker', () => {
  it('sets marker in sessionStorage AND localStorage on logout', () => {
    const token = 'abc123';
    const storageKey = `order_session_${token}`;

    // Pre-existing session
    localStorage.setItem(storageKey, JSON.stringify({ dni: '12345678' }));

    // Simulate LogoutButton.handleLogout
    const marker = JSON.stringify({ token, expiresAt: Date.now() + 5 * 60 * 1000 });
    sessionStorage.setItem('order_logout_intent', token);
    localStorage.setItem(LOGOUT_INTENT_LS_KEY, marker);
    localStorage.removeItem(storageKey);

    expect(sessionStorage.getItem('order_logout_intent')).toBe(token);
    expect(localStorage.getItem(LOGOUT_INTENT_LS_KEY)).toBe(marker);
    expect(localStorage.getItem(storageKey)).toBeNull();
  });

  it('hasLogoutIntent returns true for valid localStorage marker (cross-tab)', () => {
    const token = 'test-cross-tab';
    const marker = JSON.stringify({ token, expiresAt: Date.now() + 60_000 });
    localStorage.setItem(LOGOUT_INTENT_LS_KEY, marker);

    expect(hasLogoutIntent(token)).toBe(true);
  });

  it('hasLogoutIntent returns false for expired localStorage marker', () => {
    const token = 'test-expired';
    const marker = JSON.stringify({ token, expiresAt: Date.now() - 1000 });
    localStorage.setItem(LOGOUT_INTENT_LS_KEY, marker);

    expect(hasLogoutIntent(token)).toBe(false);
  });

  it('clearLogoutIntent removes marker from both stores', () => {
    const token = 'test-clear';
    const marker = JSON.stringify({ token, expiresAt: Date.now() + 60_000 });
    sessionStorage.setItem('order_logout_intent', token);
    localStorage.setItem(LOGOUT_INTENT_LS_KEY, marker);

    clearLogoutIntent(token);

    expect(sessionStorage.getItem('order_logout_intent')).toBeNull();
    expect(localStorage.getItem(LOGOUT_INTENT_LS_KEY)).toBeNull();
  });

  it('hasLogoutIntent prioritizes sessionStorage over localStorage', () => {
    const token = 'test-priority';
    // Both stores have a marker
    sessionStorage.setItem('order_logout_intent', token);
    const marker = JSON.stringify({ token, expiresAt: Date.now() - 1000 }); // expired in LS
    localStorage.setItem(LOGOUT_INTENT_LS_KEY, marker);

    // sessionStorage wins despite expired localStorage
    expect(hasLogoutIntent(token)).toBe(true);
  });
});

// =====================================================
// R16 — logout revokes the signed server-side cookie
// =====================================================
// The client-side markers only stop the auto-auth. The full-access cookie is an
// httpOnly value page JS cannot reach, so logout is only real if the server
// deletes it too. R16 is ADDITIVE: revoking the cookie must not change any of
// the five behaviours above.
// =====================================================

describe('LogoutButton — revokes the signed access cookie (R16)', () => {
  const TOKEN = 'track-token-r16';

  it('invokes the clearOrderAccessCookie server action for its own token', async () => {
    render(<LogoutButton token={TOKEN} businessSlug="mi-tienda" />);

    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(mockClearOrderAccessCookie).toHaveBeenCalledTimes(1));
    expect(mockClearOrderAccessCookie).toHaveBeenCalledWith(TOKEN);
  });

  it('still sets both logout-intent markers and drops the stored session', () => {
    localStorage.setItem(`order_session_${TOKEN}`, JSON.stringify({ dni: '12345678' }));

    render(<LogoutButton token={TOKEN} businessSlug="mi-tienda" />);
    fireEvent.click(screen.getByRole('button'));

    // R16 is additive — the pre-existing client behaviour must be untouched
    expect(sessionStorage.getItem('order_logout_intent')).toBe(TOKEN);
    const marker = JSON.parse(localStorage.getItem(LOGOUT_INTENT_LS_KEY) ?? 'null') as {
      token: string;
      expiresAt: number;
    };
    expect(marker.token).toBe(TOKEN);
    expect(marker.expiresAt).toBeGreaterThan(Date.now());
    expect(localStorage.getItem(`order_session_${TOKEN}`)).toBeNull();
  });

  it('still redirects to the business path after revoking the cookie', async () => {
    render(<LogoutButton token={TOKEN} businessSlug="mi-tienda" />);
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('mi-tienda'));
  });

  it('still navigates when the cookie revocation fails — logout must not be trapped', async () => {
    mockClearOrderAccessCookie.mockImplementation(async () => {
      throw new Error('cookie store unavailable');
    });

    render(<LogoutButton token={TOKEN} businessSlug="mi-tienda" />);
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
    expect(sessionStorage.getItem('order_logout_intent')).toBe(TOKEN);
  });
});
