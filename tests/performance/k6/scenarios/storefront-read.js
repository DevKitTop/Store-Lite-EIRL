// Storefront read path: the anonymous traffic the platform actually receives.
//
// Covers the two server-rendered routes that do the most database work:
//   GET /{businessSlug}                     -> catalogue (categories + products)
//   GET /{businessSlug}/product/{slug}      -> product detail
//
// Read-only. No writes, no sessions, safe against staging.
//
//   k6 run tests/performance/k6/scenarios/storefront-read.js
//   $env:K6_PROFILE="baseline"; k6 run tests/performance/k6/scenarios/storefront-read.js
//
// Profiles: smoke (default), baseline, load, stress, spike, soak.

import { check, sleep } from 'k6';
import http from 'k6/http';

import { baseUrl, buildOptions, businessSlug, thinkTimeMs } from '../lib/config.js';
import { homePath, pickProductSlug, productPath, requestHeaders } from '../lib/data.js';

export const options = buildOptions({ scenario: 'storefront-read' });

function isHealthyBody(body) {
  return typeof body === 'string' && body.length > 5000 && !body.includes('Application error');
}

export default function () {
  const home = http.get(`${baseUrl}${homePath()}`, {
    headers: requestHeaders,
    tags: { endpoint: 'storefront-home' },
  });

  check(home, {
    'home: status is 200': (r) => r.status === 200,
    'home: renders the business slug': (r) =>
      typeof r.body === 'string' && r.body.includes(businessSlug),
    'home: returns a full page': (r) => isHealthyBody(r.body),
  });

  sleep(thinkTimeMs / 1000);

  const productSlug = pickProductSlug(__VU + __ITER);
  const product = http.get(`${baseUrl}${productPath(productSlug)}`, {
    headers: requestHeaders,
    tags: { endpoint: 'storefront-product' },
  });

  check(product, {
    'product: status is 200': (r) => r.status === 200,
    'product: renders the requested slug': (r) =>
      typeof r.body === 'string' && r.body.includes(productSlug),
    'product: returns a full page': (r) => isHealthyBody(r.body),
  });

  sleep(thinkTimeMs / 1000);
}
