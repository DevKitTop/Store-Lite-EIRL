// =====================================================
// beginOrderReauthentication — the one place the client recovers (W1 / W3)
// =====================================================
// Four surfaces (`ConfirmationFlow`, `ReportFlow`, `ActionModals`,
// `ReportV2Flow`) each need the same three-step recovery when the server
// answers `reauth_required`. Copy-pasted four times it would drift, and the
// load-bearing third step — the real reload — is exactly the step that a
// stubbed `useRouter` cannot observe, so it is the step most likely to be
// dropped.
//
// WHY A RELOAD AND NOT ONLY `router.refresh()`. `OrderAuthGate`'s `checkAuth`
// effect depends on `[storageKey, searchParams, token, pathname, router]`
// (`OrderAuthGate.tsx:217`). A refresh changes none of them: the URL is the same
// and `useRouter()` returns a stable object. So the effect does not re-run,
// `isAuthenticated` stays `true` and the buyer is never re-prompted. Only a
// document reload rebuilds the tree and re-runs the check. That also covers
// S5: `serverPreAuth` is read at `:151` but missing from the deps, so an
// in-place re-render would keep the stale value too.
// =====================================================

import {
  beginOrderReauthentication,
  orderSessionStorageKey,
} from '@/app/[slug]/(app)/order/[token]/orderReauth';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const TOKEN = 'tok-helper';
const OTHER_TOKEN = 'tok-somebody-else';

let reloadSpy: ReturnType<typeof vi.fn>;
let originalLocation: Location;

beforeEach(() => {
  originalLocation = window.location;
  reloadSpy = vi.fn();
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: {
      href: originalLocation.href,
      origin: originalLocation.origin,
      pathname: originalLocation.pathname,
      search: originalLocation.search,
      hash: originalLocation.hash,
      reload: reloadSpy,
    },
  });
});

afterEach(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: originalLocation,
  });
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('orderSessionStorageKey — the key OrderAuthGate actually reads', () => {
  test('is the `order_session_` + token form read at OrderAuthGate.tsx:49/:163', () => {
    // If this ever drifts from the gate's key, the clear silently misses and the
    // buyer stays stranded — which is the exact bug this handoff exists to fix.
    expect(orderSessionStorageKey(TOKEN)).toBe(`order_session_${TOKEN}`);
  });
});

describe('beginOrderReauthentication', () => {
  test('drops the stale marker, refreshes, and forces a real document reload', () => {
    localStorage.setItem(orderSessionStorageKey(TOKEN), '{"dni":"87654321"}');
    const refresh = vi.fn();

    beginOrderReauthentication(TOKEN, refresh);

    expect(localStorage.getItem(orderSessionStorageKey(TOKEN))).toBeNull();
    expect(refresh).toHaveBeenCalledTimes(1);
    // The load-bearing step: `refresh` cannot re-run the gate's effect.
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  test('leaves other orders\u2019 sessions alone', () => {
    localStorage.setItem(orderSessionStorageKey(TOKEN), '{"dni":"87654321"}');
    localStorage.setItem(orderSessionStorageKey(OTHER_TOKEN), '{"dni":"11111111"}');

    beginOrderReauthentication(TOKEN, vi.fn());

    expect(localStorage.getItem(orderSessionStorageKey(OTHER_TOKEN))).toBe('{"dni":"11111111"}');
  });

  test('still reloads when there is no marker to drop', () => {
    const refresh = vi.fn();

    expect(() => beginOrderReauthentication(TOKEN, refresh)).not.toThrow();

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  test('still reloads when localStorage itself throws (private mode / quota)', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('SecurityError: storage is disabled');
    });
    const refresh = vi.fn();

    expect(() => beginOrderReauthentication(TOKEN, refresh)).not.toThrow();

    // Losing the marker is recoverable — the gate re-checks and re-prompts — so
    // a storage failure MUST NOT strand the buyer on a dead button.
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });
});
