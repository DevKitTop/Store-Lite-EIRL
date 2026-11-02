// Shared k6 configuration.
//
// Every value is overridable through the K6_* environment variables so the
// same scenario runs against local, staging, or a preview deployment without
// editing the script.

const DEFAULT_PRODUCT_SLUGS =
  'polo-algodon,casaca-denim,pantalon-cargo,gorra-bordada,mochila-urbana,taza-ceramica';

export const baseUrl = (__ENV.K6_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');

export const businessSlug = __ENV.K6_BUSINESS_SLUG || 'demo-store';

export const productSlugs = (__ENV.K6_PRODUCT_SLUGS || DEFAULT_PRODUCT_SLUGS)
  .split(',')
  .map((slug) => slug.trim())
  .filter(Boolean);

export const thinkTimeMs = Number(__ENV.K6_THINK_TIME_MS || 1000);

export const profileName = __ENV.K6_PROFILE || 'smoke';

// Stage shapes from the validation strategy (section 5.4). Targets are VUs,
// never latency objectives: thresholds are calibrated from a measured baseline.
export const PROFILES = {
  smoke: [
    { duration: '20s', target: 2 },
    { duration: '40s', target: 2 },
  ],
  baseline: [
    { duration: '1m', target: 10 },
    { duration: '9m', target: 10 },
  ],
  load: [
    { duration: '2m', target: 20 },
    { duration: '16m', target: 20 },
    { duration: '2m', target: 0 },
  ],
  stress: [
    { duration: '2m', target: 20 },
    { duration: '2m', target: 40 },
    { duration: '2m', target: 60 },
    { duration: '2m', target: 80 },
    { duration: '2m', target: 100 },
    { duration: '5m', target: 100 },
    { duration: '2m', target: 0 },
  ],
  spike: [
    { duration: '10s', target: 100 },
    { duration: '1m', target: 100 },
    { duration: '10s', target: 0 },
  ],
  soak: [
    { duration: '2m', target: 25 },
    { duration: '2h', target: 25 },
    { duration: '2m', target: 0 },
  ],
};

// Latency thresholds stay disabled until a baseline is measured.
// Set K6_P95_MS once you know the real number for this environment.
export function thresholds() {
  const result = {
    checks: ['rate>0.99'],
    http_req_failed: ['rate<0.01'],
  };

  const p95 = Number(__ENV.K6_P95_MS || 0);
  if (p95 > 0) {
    result.http_req_duration = [`p(95)<${p95}`];
  }

  return result;
}

export function buildOptions(tags = {}) {
  const stages = PROFILES[profileName] || PROFILES.smoke;

  return {
    scenarios: {
      default: {
        executor: 'ramping-vus',
        startVUs: 0,
        stages,
        gracefulRampDown: '10s',
        tags: { profile: profileName, ...tags },
      },
    },
    thresholds: thresholds(),
    summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'max'],
  };
}
