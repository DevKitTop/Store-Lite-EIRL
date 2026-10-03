// =====================================================
// ORDER ACCESS GATE — the single authorization chokepoint for mutations (R19)
// =====================================================
// `updateOrderStatus`, `reportIssueV2` and `confirmFinalization` used to be
// gated on `callerProof`, which the client keeps in `localStorage`. That is not
// an authorization decision — it is a value the caller chooses and re-sends on
// every request, so it proves nothing an attacker cannot prove too.
// `confirmFinalization` did not even take one.
//
// The signed httpOnly cookie minted by `verifyOrderAccess` IS an authorization
// decision: the buyer cannot read it, cannot replay it for another order, and
// cannot choose its own expiry. So it becomes the primary gate and `callerProof`
// demotes to defense-in-depth (R19).
//
// WHY A HELPER EXISTS AT ALL. Three actions needed the identical check, and a
// check that is copy-pasted three times is a check that gets dropped from one of
// them on the next refactor. The shape deliberately mirrors the repo's existing
// `requireOrderManager` (`finalizationActions.ts:67-69`): a discriminated
// result, no throwing, and a module-level neutral error constant.
//
// WHY `reauth_required` IS THE ONLY REASON THIS GATE EMITS. Every way
// `verifyOrderAccessCookie` can fail — absent, malformed, tampered, expired,
// bound to another order's token, or signed with an unset secret — is the same
// situation from the buyer's side: this browser no longer holds proof it owns
// this order, and re-minting with DNI + order number fixes all of them. The two
// remaining reasons in the vocabulary (`order_not_found`,
// `order_not_actionable`) describe the ORDER, not the caller, so they are the
// caller's to emit after it has read the row (design D4).
//
// Server-only by way of `orderAccessCookie`'s `node:crypto` import, which makes
// any client bundle fail at build — the intended failure mode.
// =====================================================

import { verifyOrderAccessCookie } from '@/lib/orderAccessCookie';

/**
 * Machine-readable refusal vocabulary (R20). `reauth_required` is RECOVERABLE —
 * the client clears its session marker and hands off to `OrderAuthGate`, which
 * re-mints. The other two are generic and must never be shown as a re-auth
 * prompt, or a buyer chasing a non-auth problem gets sent into a loop of
 * re-minting that can never succeed.
 */
export type OrderAccessRefusalReason =
  | 'reauth_required'
  | 'order_not_found'
  | 'order_not_actionable';

/** Discriminated gate outcome — never a bare boolean, so R20 can be honoured. */
export type OrderAccessDecision = { ok: true } | { ok: false; reason: OrderAccessRefusalReason };

/**
 * One neutral string for every refusal, mirroring `NO_PERMISSION_ERROR`
 * (`finalizationActions.ts:24`): an unauthorized caller learns nothing about
 * whether the order exists, what state it is in, or which check failed.
 */
export const ORDER_ACCESS_DENIED_ERROR = 'Necesitás volver a verificar tu acceso al pedido.';

/**
 * The gate itself.
 *
 * Callers MUST run this at the top of the action, BEFORE the first DB read and
 * outside any status-flow branch — the same contract as `requireOrderManager`.
 * That ordering is load-bearing, not cosmetic: a check placed after the read
 * still lets an unauthorized caller make the server touch `payments`, and
 * `orderMutationCookieGate.test.ts` asserts the ordering rather than trusting it.
 *
 * Fails closed by construction, since `verifyOrderAccessCookie` returns `false`
 * when `ORDER_ACCESS_COOKIE_SECRET` is unset (R18).
 */
export async function requireOrderAccess(trackingToken: string): Promise<OrderAccessDecision> {
  const hasAccess = await verifyOrderAccessCookie(trackingToken);
  if (!hasAccess) return { ok: false, reason: 'reauth_required' };
  return { ok: true };
}
