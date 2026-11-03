// Order tracking: the page a buyer refreshes while waiting for delivery.
//
// GET /{slug}/order/{trackingToken}. The token IS the URL secret, so this path
// needs no session and no cookie: it is a genuinely public read.
//
// The token comes from `scripts/seed.ts`. Override it for an environment with
// different data:
//
//   $env:K6_ORDER_TOKEN  = "demo-tracking-token-0001"
//   $env:K6_ORDER_NUMBER = "DEMO-0001"
//   k6 run tests/performance/k6/scenarios/order-lookup.js
//
// The negative path (unknown token must answer 404, never another tenant's
// order) is deliberately NOT probed here. k6 counts a 404 as a failed request,
// so a single expected miss would trip the run's own integrity threshold and
// abort the load test. That assertion belongs to a correctness test, not to a
// scenario whose job is measuring latency.

import { check, sleep } from 'k6';
import http from 'k6/http';

import { baseUrl, buildOptions, thinkTimeMs } from '../lib/config.js';
import { isAppPage, looksLikeProtectionWall, orderPath, requestHeaders } from '../lib/data.js';

const orderToken = __ENV.K6_ORDER_TOKEN || 'demo-tracking-token-0001';
const orderNumber = __ENV.K6_ORDER_NUMBER || 'DEMO-0001';

export const options = buildOptions({ scenario: 'order-lookup' });

export default function () {
  const response = http.get(`${baseUrl}${orderPath(orderToken)}`, {
    headers: requestHeaders,
    tags: { endpoint: 'order-tracking' },
  });

  check(response, {
    'order: status is 200': (r) => r.status === 200,
    'order: is the app, not a protection wall': (r) => !looksLikeProtectionWall(r.body),
    'order: shows the seeded order number': (r) =>
      typeof r.body === 'string' && r.body.includes(orderNumber),
    'order: returns a full page': (r) => isAppPage(r.body),
  });

  sleep(thinkTimeMs / 1000);
}
