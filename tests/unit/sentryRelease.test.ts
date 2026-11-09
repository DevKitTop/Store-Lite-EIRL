import { describe, expect, test } from 'vitest';

import { resolveSentryRelease } from '@/lib/sentryRelease';

describe('resolveSentryRelease', () => {
  test('prefers an explicit SENTRY_RELEASE override', () => {
    expect(
      resolveSentryRelease({
        SENTRY_RELEASE: 'v1.2.3',
        VERCEL_GIT_COMMIT_SHA: 'abc123',
      }),
    ).toBe('v1.2.3');
  });

  test('falls back to the public commit sha exposed to the client bundle', () => {
    expect(
      resolveSentryRelease({
        NEXT_PUBLIC_SENTRY_RELEASE: 'sha-from-build',
        VERCEL_GIT_COMMIT_SHA: 'abc123',
      }),
    ).toBe('sha-from-build');
  });

  test('falls back to the Vercel commit sha', () => {
    expect(resolveSentryRelease({ VERCEL_GIT_COMMIT_SHA: 'abc123' })).toBe('abc123');
  });

  test('trims surrounding whitespace', () => {
    expect(resolveSentryRelease({ SENTRY_RELEASE: '  abc123  ' })).toBe('abc123');
  });

  test('returns undefined when nothing is configured', () => {
    expect(resolveSentryRelease({})).toBeUndefined();
  });

  test('treats blank values as not configured', () => {
    expect(resolveSentryRelease({ SENTRY_RELEASE: '   ' })).toBeUndefined();
    expect(resolveSentryRelease({ SENTRY_RELEASE: '', VERCEL_GIT_COMMIT_SHA: '' })).toBeUndefined();
  });

  test('ignores the broken legacy variable name', () => {
    // The repo used to read NEXT_SENTRY_DSN_RELEASE, which never existed.
    // A release that silently resolves to undefined disables correlation.
    expect(resolveSentryRelease({ NEXT_SENTRY_DSN_RELEASE: 'legacy' })).toBeUndefined();
  });
});
