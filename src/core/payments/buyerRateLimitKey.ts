import { createHash } from 'node:crypto';

/**
 * Buyer-scoped rate limiting for the charge endpoint (W-P2).
 *
 * The pre-existing limiter keyed the charge bucket on `${businessId}:${productId}`
 * only, so a single buyer could fan out across products (and a shared NAT/proxy
 * could not be distinguished from one abusive client). This adds a second,
 * independent bucket scoped to the buyer.
 *
 * The buyer identity available at the charge request is PII — an email and/or a
 * DNI (from `metadata.shippingInfo`), or the signed-in customer's auth id. Raw
 * PII MUST NOT be retained in the in-memory limiter map, so only a namespaced
 * SHA-256 digest reaches the key. The digest is truncated to 32 hex characters
 * (128 bits) — far beyond any collision risk for a rate-limit bucket.
 */

export interface BuyerRateLimitIdentity {
  businessId: string;
  productId: string;
  email?: string | null;
  dni?: string | null;
  authId?: string | null;
}

/**
 * Hash an already-namespaced buyer identity (e.g. `email:buyer@test.com`).
 * Exported for direct testing of the digest contract.
 */
export function hashBuyerIdentity(namespacedIdentity: string): string {
  return createHash('sha256').update(namespacedIdentity).digest('hex').slice(0, 32);
}

/**
 * Pick the strongest available buyer identity, namespaced by kind so that the
 * text `x` as an email can never hash to the same value as `x` as a DNI.
 * Returns `null` when the request carries no usable identity.
 */
function pickBuyerIdentity({
  email,
  dni,
  authId,
}: Pick<BuyerRateLimitIdentity, 'email' | 'dni' | 'authId'>): string | null {
  const trimmedEmail = email?.trim().toLowerCase();
  if (trimmedEmail) return `email:${trimmedEmail}`;

  const trimmedDni = dni?.trim();
  if (trimmedDni) return `dni:${trimmedDni}`;

  const trimmedAuthId = authId?.trim();
  if (trimmedAuthId) return `auth:${trimmedAuthId}`;

  return null;
}

/**
 * Build the buyer-scoped limiter key, or `null` when there is no buyer identity
 * to scope by (in which case the caller only applies the business:product
 * limiter).
 */
export function buildBuyerRateLimitKey(identity: BuyerRateLimitIdentity): string | null {
  const raw = pickBuyerIdentity(identity);
  if (!raw) return null;

  return `${identity.businessId}:${identity.productId}:buyer:${hashBuyerIdentity(raw)}`;
}
