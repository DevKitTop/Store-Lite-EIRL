// API rate limiting: does the limiter actually enforce its budget?
//
// Edge rate limiting applies to /api/* (30 req/min) and /auth/* (10 req/15min)
// - see `resolveRateLimitConfig` in src/lib/middleware/proxyPipeline.ts.
//
// The limiter is an in-memory sliding window keyed by client identifier, so a
// previous run inside the same window legitimately shifts the boundary. Phase 0
// therefore waits for a clean window before probing; the final checks only mean
// something if that phase succeeded.
//
//   k6 run tests/performance/k6/scenarios/api-ratelimit.js
//   $env:K6_API_PATH="/api/order/lookup"; k6 run tests/performance/k6/scenarios/api-ratelimit.js
//
// The default target is a cheap unauthenticated GET. Do not point this at an
// endpoint that writes.

import { check, sleep } from 'k6';
import http from 'k6/http';
import { Trend } from 'k6/metrics';

import { baseUrl } from '../lib/config.js';
import { vercelBypassHeaders } from '../lib/data.js';

const apiPath = __ENV.K6_API_PATH || '/api/auth/user';
const budget = Number(__ENV.K6_RATE_LIMIT_MAX || 30);
const probes = Number(__ENV.K6_RATE_LIMIT_PROBES || 35);
const maxResetAttempts = 12;

const firstBlockedAt = new Trend('rate_limit_first_blocked_at', true);

export const options = {
  scenarios: {
    default: {
      executor: 'shared-iterations',
      vus: 1,
      iterations: 1,
      maxDuration: '3m',
    },
  },
  thresholds: {
    // Deliberately no `http_req_failed` threshold: k6 counts every 429 as a
    // failed request and this scenario is designed to produce them. The
    // `checks` threshold is the pass/fail signal here.
    checks: ['rate>0.99'],
  },
  summaryTrendStats: ['min', 'med', 'p(95)', 'max'],
};

function probe() {
  return http.get(`${baseUrl}${apiPath}`, {
    headers: { Accept: 'application/json', ...vercelBypassHeaders },
    tags: { endpoint: 'api-rate-limited' },
  });
}

export default function () {
  // Phase 0 - wait until the window is clear. A blocked response answers
  // immediately and costs nothing, so polling is cheap; a successful one starts
  // the window, which is why its count is included in the probe sequence below.
  let response = probe();
  let resetAttempts = 0;

  while (response.status === 429 && resetAttempts < maxResetAttempts) {
    const retryAfterSeconds = Number(response.headers['Retry-After'] || 10);
    sleep(Math.min(retryAfterSeconds + 1, 20));
    response = probe();
    resetAttempts += 1;
  }

  const windowWasClear = response.status !== 429;

  let allowed = 0;
  let blocked = 0;
  let serverErrors = 0;
  let firstBlockedIndex = -1;
  let retryAfterHeader = '';

  for (let index = 1; index <= probes; index += 1) {
    if (index > 1) response = probe();

    if (response.status === 429) {
      blocked += 1;
      if (firstBlockedIndex === -1) {
        firstBlockedIndex = index;
        retryAfterHeader = response.headers['Retry-After'] || response.headers['retry-after'] || '';
      }
    } else if (response.status >= 500) {
      serverErrors += 1;
    } else {
      allowed += 1;
    }
  }

  if (firstBlockedIndex > 0) {
    firstBlockedAt.add(firstBlockedIndex);
  }

  check(
    {
      allowed,
      blocked,
      budget,
      probes,
      serverErrors,
      firstBlockedIndex,
      retryAfterHeader,
      windowWasClear,
    },
    {
      'window was clear before probing': (r) => r.windowWasClear,
      'limiter blocks at least one request': (r) => r.blocked > 0,
      'exactly the configured budget is allowed': (r) => r.allowed === r.budget,
      'blocked responses carry a numeric Retry-After': (r) =>
        /^\d+$/.test(String(r.retryAfterHeader)),
      'no server errors while probing': (r) => r.serverErrors === 0,
    },
  );
}
