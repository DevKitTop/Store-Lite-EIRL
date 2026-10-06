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

describe('env — WhatsApp send guards rate limiting', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('defaults the per-window rate limit to 100 sends / 5 minutes', async () => {
    vi.stubEnv('WHATSAPP_RATE_LIMIT_PER_WINDOW', '');
    vi.stubEnv('WHATSAPP_RATE_LIMIT_WINDOW_MINUTES', '');
    vi.resetModules();

    const { env } = await import('@/config/env');

    expect(env.whatsappRateLimitPerWindow).toBe('100');
    expect(env.whatsappRateLimitWindowMinutes).toBe('5');
  });

  it('reads custom rate limit values from env (kept as strings, parsed in the guard)', async () => {
    vi.stubEnv('WHATSAPP_RATE_LIMIT_PER_WINDOW', '250');
    vi.stubEnv('WHATSAPP_RATE_LIMIT_WINDOW_MINUTES', '10');
    vi.resetModules();

    const { env } = await import('@/config/env');

    expect(env.whatsappRateLimitPerWindow).toBe('250');
    expect(env.whatsappRateLimitWindowMinutes).toBe('10');
  });
});
