// Authentication helpers for scenarios that need a real session.
//
// Credentials are never committed: they come from K6_AUTH_EMAIL and
// K6_AUTH_PASSWORD. The Supabase endpoint defaults to the local stack.

import http from 'k6/http';

export const supabaseUrl = (__ENV.K6_SUPABASE_URL || 'http://127.0.0.1:54321').replace(/\/+$/, '');

export function requireEnv(name) {
  const value = __ENV[name];
  if (!value) {
    throw new Error(
      `${name} is required. Set it before running this scenario (never hardcode credentials).`,
    );
  }
  return value;
}

/**
 * Password grant against Supabase Auth (GoTrue).
 *
 * Returns the raw k6 response so the caller can tag it and assert on it.
 */
export function login(email, password) {
  const anonKey = requireEnv('K6_SUPABASE_ANON_KEY');

  return http.post(
    `${supabaseUrl}/auth/v1/token?grant_type=password`,
    JSON.stringify({ email, password }),
    {
      headers: {
        'Content-Type': 'application/json',
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
      },
      tags: { endpoint: 'supabase-auth-token' },
    },
  );
}

export function accessTokenOf(response) {
  if (response.status !== 200 || typeof response.body !== 'string') return null;

  try {
    const parsed = JSON.parse(response.body);
    return typeof parsed.access_token === 'string' && parsed.access_token.length > 0
      ? parsed.access_token
      : null;
  } catch {
    return null;
  }
}
