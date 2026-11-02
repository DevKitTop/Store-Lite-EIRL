// Test data and URL builders.
//
// Slugs come from `scripts/seed.ts` for local runs. Against staging they must
// exist in that environment too, otherwise K6_PRODUCT_SLUGS has to be updated.

import { businessSlug, productSlugs } from './config.js';

export function homePath() {
  return `/${businessSlug}`;
}

export function productPath(productSlug) {
  return `/${businessSlug}/product/${productSlug}`;
}

export function orderPath(trackingToken) {
  return `/${businessSlug}/order/${trackingToken}`;
}

export function pickProductSlug(index) {
  if (productSlugs.length === 0) {
    throw new Error('No product slugs configured. Set K6_PRODUCT_SLUGS.');
  }

  return productSlugs[index % productSlugs.length];
}

// Vercel Deployment Protection bypass. Never committed: supplied at run time.
// Without it a protected preview answers 200 with a login page (see README).
export const vercelBypassHeaders = __ENV.K6_VERCEL_BYPASS
  ? { 'x-vercel-protection-bypass': __ENV.K6_VERCEL_BYPASS }
  : {};

export const requestHeaders = {
  Accept: 'text/html,application/xhtml+xml',
  'Accept-Language': 'es-PE,es;q=0.9',
  ...vercelBypassHeaders,
};

// Vercel Deployment Protection answers 200 with a login page for every path,
// and that page embeds the original URL — so a "body contains the slug" check
// passes against it. Every scenario that reads HTML must reject it explicitly.
// The wall title uses an en dash (U+2013), not an ASCII hyphen. Matching the
// literal string silently failed, which is how a login page was mistaken for
// the storefront for a whole 10-minute run.
const PROTECTION_WALL_PATTERN = /Login\s*[-\u2013\u2014]\s*Vercel/;

export function looksLikeProtectionWall(body) {
  if (typeof body !== 'string') return false;
  return PROTECTION_WALL_PATTERN.test(body) || body.includes('vercel.com/login');
}

export function isAppPage(body) {
  return (
    typeof body === 'string' &&
    body.length > 5000 &&
    !body.includes('Application error') &&
    !looksLikeProtectionWall(body)
  );
}
