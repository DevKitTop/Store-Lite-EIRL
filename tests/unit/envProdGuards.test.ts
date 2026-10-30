/**
 * Pins the server-side production guarantees of `src/config/env.ts` and the
 * split against `src/config/env.public.ts`.
 *
 * The hotfix that created `env.public.ts` moved public values out of the
 * server module without changing any production guard or any property on
 * `env`. These tests make that invariant explicit so a future refactor cannot
 * silently drop a guard or a key.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const FULL_ENV: Record<string, string> = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://p.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
  NEXT_PUBLIC_APP_URL: 'https://storelite.app',
  NEXT_PUBLIC_AUTH_ORIGIN: 'https://auth.storelite.app',
  NEXT_PUBLIC_META_PIXEL_ID: '1234567890123',
  NEXT_PUBLIC_YCLOUD_FB_APP_ID: 'a',
  NEXT_PUBLIC_YCLOUD_FB_CONFIG_ID: 'c',
  NEXT_PUBLIC_YCLOUD_FB_SOLUTION_ID: 's',
  SUPABASE_SERVICE_ROLE_KEY: 'svc',
  OTP_HASH_SECRET: 'otp',
  ORDER_ACCESS_COOKIE_SECRET: 'oa',
  CRON_SECRET: 'cron',
  CULQI_WEBHOOK_USER: 'u',
  CULQI_WEBHOOK_PASS: 'p',
  SASS_API_KEY: 'sass',
  META_CAPI_ACCESS_TOKEN: 'capi',
  META_TEST_EVENT_CODE: 'T',
  FEATURE_SUBDOMAIN_REWRITE: 'true',
  SHARED_COOKIE_DOMAIN: '.store-lite.com',
  PLATFORM_ADMIN_IDS: ' a, b ,,c ',
  ORDER_FLOW_V2: 'true',
  CULQI_ENFORCE_LIVE_KEYS: 'true',
  JSONPE_API_BASE_URL: 'https://jsonpe.example',
  JSON_TOKEN: 'j',
  JSON_WSP_INSTANCE: 'w',
  TWILIO_ACCOUNT_SID: 'sid',
  TWILIO_AUTH_TOKEN: 'tok',
  TWILIO_WHATSAPP_NUMBER: 'n',
  TWILIO_SERVICE_SID: 'v',
  JSONPE_SMS_TOKEN: 'sms',
  RESEND_API_KEY: 'r',
  RESEND_FROM_EMAIL: 'f@e.com',
  YCLOUD_API_KEY: 'y',
  YCLOUD_WABA_ID: 'waba',
  YCLOUD_WEBHOOK_SECRET: 'wh',
  WHATSAPP_RATE_LIMIT_PER_WINDOW: '50',
  WHATSAPP_RATE_LIMIT_WINDOW_MINUTES: '7',
};

/** Every property `env` exposed before the env.public split — 37 keys. */
const BASELINE_ENV_KEYS = [
  'authOrigin',
  'culqiWebhookPass',
  'culqiWebhookUser',
  'cronSecret',
  'enforceLiveCulqiKeys',
  'featureSubdomainRewrite',
  'jsonToken',
  'jsonWspInstance',
  'jsonpeApiBaseUrl',
  'jsonpeSmsToken',
  'metaCapiAccessToken',
  'metaPixelId',
  'metaTestEventCode',
  'nextPublicAppUrl',
  'orderAccessCookieSecret',
  'orderFlowV2',
  'otpHashSecret',
  'platformAdminIds',
  'resendApiKey',
  'resendFromEmail',
  'sassApiKey',
  'sharedCookieDomain',
  'supabaseAnonKey',
  'supabaseServiceRoleKey',
  'supabaseUrl',
  'twilioAccountSid',
  'twilioAuthToken',
  'twilioServiceSid',
  'twilioWhatsAppNumber',
  'whatsappRateLimitPerWindow',
  'whatsappRateLimitWindowMinutes',
  'ycloudApiKey',
  'ycloudFbAppId',
  'ycloudFbConfigId',
  'ycloudFbSolutionId',
  'ycloudWabaId',
  'ycloudWebhookSecret',
];

const SERVER_SECRETS = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'JSON_TOKEN',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_SERVICE_SID',
  'JSONPE_SMS_TOKEN',
  'CULQI_WEBHOOK_PASS',
  'RESEND_API_KEY',
  'OTP_HASH_SECRET',
  'ORDER_ACCESS_COOKIE_SECRET',
  'CRON_SECRET',
  'SASS_API_KEY',
  'META_CAPI_ACCESS_TOKEN',
  'YCLOUD_API_KEY',
  'YCLOUD_WABA_ID',
  'YCLOUD_WEBHOOK_SECRET',
];

const PRODUCTION_GUARDS: [string, string][] = [
  ['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY is required in production'],
  ['OTP_HASH_SECRET', 'OTP_HASH_SECRET is required in production'],
  ['ORDER_ACCESS_COOKIE_SECRET', 'ORDER_ACCESS_COOKIE_SECRET is required in production'],
  ['CRON_SECRET', 'CRON_SECRET is required in production'],
  ['CULQI_WEBHOOK_USER', 'CULQI_WEBHOOK_USER and CULQI_WEBHOOK_PASS are required in production'],
  ['CULQI_WEBHOOK_PASS', 'CULQI_WEBHOOK_USER and CULQI_WEBHOOK_PASS are required in production'],
  ['SASS_API_KEY', 'SASS_API_KEY is required in production'],
];

function stubFullEnv(omitted: string[] = []): void {
  for (const [name, value] of Object.entries(FULL_ENV)) {
    vi.stubEnv(name, omitted.includes(name) ? '' : value);
  }
}

function stubProduction(): void {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('CI', '');
  vi.stubEnv('GITHUB_ACTIONS', '');
}

describe('env — production guards survive the env.public split', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it.each(PRODUCTION_GUARDS)(
    'throws when %s is missing in production',
    async (omitted, message) => {
      stubFullEnv([omitted]);
      stubProduction();
      vi.resetModules();

      await expect(import('@/config/env')).rejects.toThrow(message);
    },
  );

  it('CI=true bypasses the production throws', async () => {
    stubFullEnv(PRODUCTION_GUARDS.map(([name]) => name));
    stubProduction();
    vi.stubEnv('CI', 'true');
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.resetModules();

    const { env } = await import('@/config/env');

    expect(env.supabaseServiceRoleKey).toBe('');
  });

  it('keeps every baseline key and value semantic on the server', async () => {
    stubFullEnv();
    stubProduction();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.resetModules();

    const { env } = await import('@/config/env');
    const values = env as Record<string, unknown>;

    expect(Object.keys(env).sort()).toEqual([...BASELINE_ENV_KEYS].sort());
    for (const key of BASELINE_ENV_KEYS) expect(values[key]).not.toBeUndefined();
    expect(env.supabaseUrl).toBe(FULL_ENV.NEXT_PUBLIC_SUPABASE_URL);
    expect(env.metaPixelId).toBe(FULL_ENV.NEXT_PUBLIC_META_PIXEL_ID);
    expect(env.ycloudFbSolutionId).toBe(FULL_ENV.NEXT_PUBLIC_YCLOUD_FB_SOLUTION_ID);
    expect(env.orderFlowV2).toBe(true);
    expect(env.featureSubdomainRewrite).toBe(true);
    expect(env.sharedCookieDomain).toBe('.store-lite.com');
    expect(env.platformAdminIds).toEqual(['a', 'b', 'c']);
    expect(env.cronSecret).toBe('cron');
    expect(env.whatsappRateLimitPerWindow).toBe('50');
  });

  it('public module exposes only public values', async () => {
    stubFullEnv();
    vi.resetModules();

    const { publicEnv } = await import('@/config/env.public');
    const source = readFileSync(path.resolve(process.cwd(), 'src/config/env.public.ts'), 'utf8');

    expect(Object.keys(publicEnv).sort()).toEqual([
      'authOrigin',
      'featureSubdomainRewrite',
      'metaPixelId',
      'nextPublicAppUrl',
      'supabaseAnonKey',
      'supabaseUrl',
      'ycloudFbAppId',
      'ycloudFbConfigId',
      'ycloudFbSolutionId',
    ]);
    expect(SERVER_SECRETS.filter((name) => source.includes(name))).toEqual([]);
  });
});
