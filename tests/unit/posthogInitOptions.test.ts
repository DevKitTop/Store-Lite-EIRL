import { buildPostHogInitOptions } from '@/shared/analytics/posthogInitOptions';
import { describe, expect, test } from 'vitest';

describe('buildPostHogInitOptions', () => {
  test('routes through the /ingest proxy in production', () => {
    const options = buildPostHogInitOptions({ isDev: false, host: 'https://us.i.posthog.com' });

    expect(options.api_host).toBe('/ingest');
    expect(options.ui_host).toBe('https://us.i.posthog.com');
    expect(options.debug).toBe(false);
  });

  test('talks to PostHog directly in development', () => {
    const options = buildPostHogInitOptions({ isDev: true, host: 'https://us.i.posthog.com' });

    expect(options.api_host).toBe('https://us.i.posthog.com');
    expect(options.debug).toBe(true);
  });

  test('falls back to the default host when none is configured', () => {
    const options = buildPostHogInitOptions({ isDev: true });

    expect(options.api_host).toBe('https://us.i.posthog.com');
    expect(options.ui_host).toBe('https://us.posthog.com');
  });

  test('overrides the remote config so Web Vitals are collected', () => {
    const options = buildPostHogInitOptions({ isDev: false });

    // The project's remote config answers `web_vitals: false`; an object here
    // is what overrides it, so this assertion pins the only working path.
    expect(options.capture_performance).toEqual({
      network_timing: true,
      web_vitals: true,
    });
  });

  test('keeps exception autocapture and the dashboard defaults preset', () => {
    const options = buildPostHogInitOptions({ isDev: false });

    expect(options.capture_exceptions).toBe(true);
    expect(options.defaults).toBe('2026-01-30');
  });
});
