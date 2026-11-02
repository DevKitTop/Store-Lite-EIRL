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

export function pickProductSlug(index) {
  if (productSlugs.length === 0) {
    throw new Error('No product slugs configured. Set K6_PRODUCT_SLUGS.');
  }

  return productSlugs[index % productSlugs.length];
}

export const requestHeaders = {
  Accept: 'text/html,application/xhtml+xml',
  'Accept-Language': 'es-PE,es;q=0.9',
};
