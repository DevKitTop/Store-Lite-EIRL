// Smoke: does the storefront answer at all?
//
// Purpose is script correctness, not measurement. One to two VUs for a minute.
//
//   k6 run tests/performance/k6/scenarios/smoke.js
//   $env:K6_BASE_URL="https://<preview>.vercel.app"; k6 run tests/performance/k6/scenarios/smoke.js

import { check, sleep } from 'k6';
import http from 'k6/http';

import { baseUrl, buildOptions, businessSlug, thinkTimeMs } from '../lib/config.js';
import { homePath, requestHeaders } from '../lib/data.js';

export const options = buildOptions({ scenario: 'smoke' });

function isHealthyBody(body) {
  return typeof body === 'string' && body.length > 5000 && !body.includes('Application error');
}

export default function () {
  const response = http.get(`${baseUrl}${homePath()}`, {
    headers: requestHeaders,
    tags: { endpoint: 'storefront-home' },
  });

  check(response, {
    'home: status is 200': (r) => r.status === 200,
    'home: renders the business slug': (r) =>
      typeof r.body === 'string' && r.body.includes(businessSlug),
    'home: returns a full page': (r) => isHealthyBody(r.body),
  });

  sleep(thinkTimeMs / 1000);
}
