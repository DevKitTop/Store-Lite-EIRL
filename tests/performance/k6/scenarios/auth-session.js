// Auth session: password login under load.
//
// Measures the Supabase Auth token endpoint, which is the first thing every
// merchant session does and the one dependency this app does not control.
//
// Requires credentials. Nothing is hardcoded:
//
//   $env:K6_SUPABASE_URL      = "http://127.0.0.1:54321"
//   $env:K6_SUPABASE_ANON_KEY = "<anon key>"
//   $env:K6_AUTH_EMAIL        = "owner@storelite.test"
//   $env:K6_AUTH_PASSWORD     = "<seed password>"
//   k6 run tests/performance/k6/scenarios/auth-session.js
//
// Safe against staging: it only creates sessions, never data. Sessions are
// rotated server-side; use throwaway accounts there.

import { check } from 'k6';

import { accessTokenOf, login, requireEnv } from '../lib/auth.js';
import { buildOptions } from '../lib/config.js';

export const options = buildOptions({ scenario: 'auth-session' });

const credentials = {
  email: requireEnv('K6_AUTH_EMAIL'),
  password: requireEnv('K6_AUTH_PASSWORD'),
};

export default function () {
  const response = login(credentials.email, credentials.password);

  check(response, {
    'login: status is 200': (r) => r.status === 200,
    'login: returns an access token': (r) => accessTokenOf(r) !== null,
    'login: returns the same user': (r) => {
      if (typeof r.body !== 'string') return false;
      try {
        return JSON.parse(r.body).user?.email === credentials.email;
      } catch {
        return false;
      }
    },
  });
}
