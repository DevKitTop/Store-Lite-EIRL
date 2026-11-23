import { describe, expect, test, vi } from 'vitest';

import { getAllowedOrigins, isJsonRequest, isSameOriginRequest } from '@/lib/security/csrf';

function request(headers: Record<string, string>): Request {
  return new Request('https://app.example.com/api/push/subscriptions', { headers });
}

describe('csrf helpers', () => {
  test('allows same-origin Fetch Metadata and rejects other sites', () => {
    expect(isSameOriginRequest(request({ 'sec-fetch-site': 'same-origin' }))).toBe(true);
    expect(isSameOriginRequest(request({ 'sec-fetch-site': 'same-site' }))).toBe(false);
    expect(isSameOriginRequest(request({ 'sec-fetch-site': 'cross-site' }))).toBe(false);
  });

  test('falls back to an allowed Origin when Fetch Metadata is absent', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example.com');
    expect(isSameOriginRequest(request({ origin: 'https://app.example.com' }))).toBe(true);
    expect(isSameOriginRequest(request({ origin: 'https://evil.example' }))).toBe(false);
  });

  test('falls back to an allowed Referer and denies requests without intent', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example.com');
    expect(isSameOriginRequest(request({ referer: 'https://app.example.com/settings' }))).toBe(
      true,
    );
    expect(isSameOriginRequest(request({}))).toBe(false);
  });

  test('normalizes configured origins and ignores invalid values', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example.com/path');
    vi.stubEnv('NEXT_PUBLIC_AUTH_ORIGIN', 'not-a-url');
    expect([...getAllowedOrigins()]).toEqual(['https://app.example.com']);
  });

  test('accepts only application/json bodies', () => {
    expect(isJsonRequest(request({ 'content-type': 'application/json; charset=utf-8' }))).toBe(
      true,
    );
    expect(isJsonRequest(request({ 'content-type': 'text/plain' }))).toBe(false);
    expect(isJsonRequest(request({}))).toBe(false);
  });
});
