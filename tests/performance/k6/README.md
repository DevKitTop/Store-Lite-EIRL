# k6 performance suite

Load testing for Store Lite's public storefront and API surface.

Every scenario here is **read-only unless its name says otherwise**. Anything
that writes must target staging, never production.

## Requirements

- k6 v1.8.2 (`k6 version`)
- A running environment. Local: `pnpm dev` plus `pnpm db:seed`, so the slugs
  below actually resolve.

## Structure

```
tests/performance/k6/
  lib/config.js         # base URL, profiles, thresholds (all env-driven)
  lib/data.js           # slugs and URL builders
  scenarios/
    smoke.js            # is the storefront reachable?
    storefront-read.js  # anonymous catalogue + product detail
    api-ratelimit.js    # is the /api/* budget actually enforced?
  results/              # JSON summaries per run (git-ignored contents)
```

`lib/auth.js` and the remaining scenarios (`order-lookup`, `auth-session`,
`checkout-mocked`, `cron-concurrent`) are not implemented yet.
Order of implementation lives in section 5.3 of
`docs/ENGINEERING_VALIDATION_AND_OBSERVABILITY_STRATEGY.md`.

## Environment variables

| Variable           | Default                 | Meaning                                                |
| ------------------ | ----------------------- | ------------------------------------------------------ |
| `K6_BASE_URL`      | `http://localhost:3000` | Target origin, no trailing slash                       |
| `K6_BUSINESS_SLUG` | `demo-store`            | Storefront under test                                  |
| `K6_PRODUCT_SLUGS` | seeded demo products    | Comma-separated product slugs                          |
| `K6_PROFILE`       | `smoke`                 | `smoke`, `baseline`, `load`, `stress`, `spike`, `soak` |
| `K6_THINK_TIME_MS` | `1000`                  | Pause between requests per VU                          |
| `K6_P95_MS`        | unset                   | Enables the `p(95)` latency threshold                  |

## Running

PowerShell:

```powershell
# Correctness check
k6 run tests/performance/k6/scenarios/smoke.js

# Read path, default profile
k6 run tests/performance/k6/scenarios/storefront-read.js

# Against staging
$env:K6_BASE_URL = "https://<preview-url>.vercel.app"
$env:K6_PROFILE = "baseline"
k6 run tests/performance/k6/scenarios/storefront-read.js

# Keep the summary
k6 run --summary-export tests/performance/k6/results/storefront-read-baseline.json `
       tests/performance/k6/scenarios/storefront-read.js
```

## Rate limiting scenario

`api-ratelimit.js` is not a load test, it is a behavioural assertion. It sends
`K6_RATE_LIMIT_PROBES` (35) sequential requests from one client and expects
`K6_RATE_LIMIT_MAX` (30) to succeed before the limiter answers 429 with a
`Retry-After` header.

Two things to know:

- The limiter is an in-memory sliding window per instance, so the scenario waits
  for a clear window first and fails if it cannot get one.
- `http_req_failed` reports roughly 14% failed. Those are the expected 429s, not
  breakage, which is why this scenario has no `http_req_failed` threshold.

Target: `K6_API_PATH`, default `/api/auth/user`. Never point it at a writing
endpoint.

## Thresholds are measured, not invented

`K6_P95_MS` is intentionally unset. Run `baseline` first, read the reported
`p(95)`, and only then set a threshold with headroom. A latency target picked
before the first measurement measures nothing but your optimism.

The check thresholds (`checks > 99%`, `http_req_failed < 1%`) are always on,
because they describe correctness, not performance.

## What a result means

A k6 result describes **the scenario you ran**: this request mix, this data
volume, this environment, this region. "200 VUs held" is not a platform
capacity claim. Change the mix or the dataset and the number is no longer
comparable.
