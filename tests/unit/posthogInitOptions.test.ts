import { buildPostHogInitOptions, resolvePostHogKey } from '@/shared/analytics/posthogInitOptions';
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

  test('does not download the session recorder or surveys bundle', () => {
    const options = buildPostHogInitOptions({ isDev: false });

    // posthog-js fetches recorder.js (69 KB) and surveys.js (48 KB) unless
    // these are disabled, and both sit on the critical path for first paint.
    expect(options.disable_session_recording).toBe(true);
    expect(options.disable_surveys).toBe(true);
  });
});

describe('resolvePostHogKey', () => {
  test('prefers NEXT_PUBLIC_POSTHOG_KEY', () => {
    expect(
      resolvePostHogKey({
        NEXT_PUBLIC_POSTHOG_KEY: 'phc_primary',
        NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: 'phc_wizard',
      }),
    ).toBe('phc_primary');
  });

  test('falls back to NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN', () => {
    // The PostHog wizard writes the token under the newer name. Reading only
    // the old one left the SDK without a key, so it never initialised.
    expect(resolvePostHogKey({ NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: 'phc_wizard' })).toBe(
      'phc_wizard',
    );
  });

  test('returns undefined when neither name is configured', () => {
    expect(resolvePostHogKey({})).toBeUndefined();
    expect(resolvePostHogKey({ NEXT_PUBLIC_POSTHOG_KEY: '' })).toBeUndefined();
  });
});
