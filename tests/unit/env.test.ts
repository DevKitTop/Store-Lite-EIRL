import { afterEach, describe, expect, it, vi } from 'vitest';

describe('env — Meta Pixel / CAPI configuration', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('maps NEXT_PUBLIC_META_PIXEL_ID and defaults to empty strings', async () => {
    vi.stubEnv('NEXT_PUBLIC_META_PIXEL_ID', '1234567890123');
    vi.stubEnv('META_CAPI_ACCESS_TOKEN', '');
    vi.stubEnv('META_TEST_EVENT_CODE', '');
    vi.resetModules();

    const { env } = await import('@/config/env');

    expect(env.metaPixelId).toBe('1234567890123');
    expect(env.metaCapiAccessToken).toBe('');
    expect(env.metaTestEventCode).toBe('');
  });

  it('reads the optional test event code when set', async () => {
    vi.stubEnv('NEXT_PUBLIC_META_PIXEL_ID', '');
    vi.stubEnv('META_CAPI_ACCESS_TOKEN', '');
    vi.stubEnv('META_TEST_EVENT_CODE', 'TEST123');
    vi.resetModules();

    const { env } = await import('@/config/env');

    expect(env.metaTestEventCode).toBe('TEST123');
  });

  it('warns when META_CAPI_ACCESS_TOKEN is missing but the app keeps running', async () => {
    vi.stubEnv('NEXT_PUBLIC_META_PIXEL_ID', '1234567890123');
    vi.stubEnv('META_CAPI_ACCESS_TOKEN', '');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.resetModules();

    const { env } = await import('@/config/env');

    expect(env.metaCapiAccessToken).toBe('');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('META_CAPI_ACCESS_TOKEN'));
  });

  it('warns when the public pixel id is missing', async () => {
    vi.stubEnv('NEXT_PUBLIC_META_PIXEL_ID', '');
    vi.stubEnv('META_CAPI_ACCESS_TOKEN', 'secret');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.resetModules();

    const { env } = await import('@/config/env');

    expect(env.metaPixelId).toBe('');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('NEXT_PUBLIC_META_PIXEL_ID'));
  });
});

// The order-access cookie signs with this secret (R13) and its whole value of
// protection is that an UNSET secret cannot authorize anybody (R18). So the one
// property worth pinning here is the divergence from `otpHashSecret` directly
// above, which uses `|| 'dev-fallback-…'` — that shape is a vulnerability when
// the secret gates an access decision rather than an OTP hash.
describe('env — order access cookie secret', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('reads ORDER_ACCESS_COOKIE_SECRET when it is set', async () => {
    vi.stubEnv('ORDER_ACCESS_COOKIE_SECRET', 'a-strong-random-string');
    vi.resetModules();

    const { env } = await import('@/config/env');

    expect(env.orderAccessCookieSecret).toBe('a-strong-random-string');
  });

  it('defaults to an empty string when unset — NEVER a dev fallback', async () => {
    vi.stubEnv('ORDER_ACCESS_COOKIE_SECRET', '');
    vi.resetModules();

    const { env } = await import('@/config/env');

    expect(env.orderAccessCookieSecret).toBe('');
    // The regression this guards: copying otpHashSecret's `|| 'dev-fallback-…'`
    // would leave a KNOWN secret in place, and a cookie signed with it would
    // verify in production forever.
    expect(env.orderAccessCookieSecret).not.toContain('fallback');
    expect(env.orderAccessCookieSecret).not.toContain('dev');
  });

  it('warns when ORDER_ACCESS_COOKIE_SECRET is missing, the way OTP_HASH_SECRET does', async () => {
    vi.stubEnv('ORDER_ACCESS_COOKIE_SECRET', '');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.resetModules();

    const { env } = await import('@/config/env');

    expect(env.orderAccessCookieSecret).toBe('');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('ORDER_ACCESS_COOKIE_SECRET'));
  });
});
