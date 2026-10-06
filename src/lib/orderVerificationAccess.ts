// =====================================================
// ORDER VERIFICATION PAGE — SINGLE SOURCE OF TRUTH FOR THE GATED SURFACE
// =====================================================
// `order/verify/[orderNumber]/page.tsx` renders two tiers: a public verdict that
// is ALWAYS shown (R22 — the URL is printed on the ticket, so the page must stay
// reachable months later with no session), and a gated surface (cart line items,
// the `trackingToken` link) that requires a verifying signed cookie.
//
// That gate used to be recomputed inline at four sites in the page: a `let`
// declaration, an assignment behind an `if`, and two reads — one before the Q_B
// query, one per render block. Four sites means four chances to drift, and the
// mutation probe showed the failure mode is SILENT: deleting the render gate on
// the cart block leaves the whole suite green, because the build guard upstream
// already emptied `cartItems`. A fifth gated field added later would forget one
// of the sites and leak with nothing failing.
//
// So the cookie check lives here, once. The page asks one question and consumes
// one boolean; every gated site reads that same binding, and there is no second
// place where `verifyOrderAccessCookie` can be called or its result re-derived.
//
// Not a redesign: same predicate, same inputs, same behaviour. `resolve` is the
// only new thing — it names the fact that the caller has already read the row
// and is asking "may I show the gated surface?", not "fetch me an order".
// =====================================================

import { verifyOrderAccessCookie } from '@/lib/orderAccessCookie';

/**
 * Resolves whether the gated surface may be rendered for a given order.
 *
 * @param trackingToken The order's `trackingToken`, read server-locally from Q_A
 *   purely to derive the cookie name (design.md D2). It is never returned and
 *   never reaches a component prop.
 * @returns `true` only when a valid, unexpired, correctly-signed
 *   `order_access_{trackingToken}` cookie is present. A missing token — a row
 *   with no `orderNumber`, or a NULL `trackingToken` — is `false` without any
 *   cookie work, so there is no undefined-guard to forget at a call site.
 */
export async function resolveOrderVerificationAccess(
  trackingToken: string | null | undefined,
): Promise<boolean> {
  if (!trackingToken) return false;

  return verifyOrderAccessCookie(trackingToken);
}
