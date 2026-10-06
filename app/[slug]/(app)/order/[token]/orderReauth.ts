'use client';

// =====================================================
// ORDER RE-AUTH HANDOFF — the client half of a recoverable refusal (R20 / W1 / W3)
// =====================================================
// When a mutation answers `reauth_required`, this browser holds a stale
// `order_session_{token}` marker while the signed cookie has lapsed (1h TTL,
// `orderAccessCookie.ts:47`). Two things must happen, in this order:
//
//  1. DROP THE MARKER. `OrderAuthGate` reads `order_session_{token}` at :49/:163
//     and would keep passing on it, stranding the buyer on a gate that believes
//     it is authenticated while the server keeps refusing. The marker is
//     client-side, so this can only happen here — never in the server action.
//
//  2. RELOAD THE DOCUMENT. `router.refresh()` is NOT enough. `OrderAuthGate`'s
//     `checkAuth` effect depends on `[storageKey, searchParams, token, pathname,
//     router]` (:217) and none of those change on an in-place refresh: the URL
//     is identical and `useRouter()` returns a stable reference. The effect
//     therefore never re-runs, `isAuthenticated` stays `true`, and the buyer is
//     never re-prompted. Only a document reload rebuilds the tree and re-runs
//     the check — which also picks up `serverPreAuth`, read at :151 but absent
//     from those deps (a stale closure that an in-place re-render would keep).
//
// `refresh` still runs first so the server tree is already current if the
// reload is ever deferred (a throttled background tab, a beforeunload guard);
// the reload is what actually re-triggers the gate.
//
// FOUR surfaces need this — `ConfirmationFlow`, `ReportFlow`, `ActionModals`
// (two mutations) and `ReportV2Flow`. Copy-pasted four times, the reload step is
// exactly the one that would silently disappear: it is invisible to a test that
// stubs `useRouter`, so nothing would fail when it was dropped.
// =====================================================

/**
 * The key `OrderAuthGate` reads. Exported so the clear and the gate cannot drift
 * apart — if this string changes, every handoff silently stops working.
 */
export function orderSessionStorageKey(trackingToken: string): string {
  return `order_session_${trackingToken}`;
}

/**
 * Recoverable refusal, client side: drop the stale marker, refresh, reload.
 *
 * `refresh` is passed in rather than a whole router so the dependency is
 * explicit and the caller stays the only thing that knows about routing.
 */
export function beginOrderReauthentication(trackingToken: string, refresh: () => void): void {
  try {
    localStorage.removeItem(orderSessionStorageKey(trackingToken));
  } catch {
    // `localStorage` throws outright in some privacy modes. Losing the marker is
    // recoverable — the gate re-checks and re-prompts — so a storage failure must
    // never leave the buyer sitting on a dead button.
  }

  refresh();

  if (typeof window !== 'undefined') {
    window.location.reload();
  }
}
