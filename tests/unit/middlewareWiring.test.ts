// =====================================================
// MIDDLEWARE WIRING — structural guard
// =====================================================
// Next.js decides where to look for the proxy by where the App Router lives.
// This project uses `app/` at the project root (there is no src/app), so the
// proxy MUST sit at the root next to it.
//
// The middleware previously lived at src/middleware.ts. Next.js compiled it —
// the bundle even existed on disk — but never registered or ran it, in any
// environment. The result was a project with no edge rate limiting, no CSP and
// no subdomain rewrite, while every unit test of the middleware's helpers
// stayed green.
//
// This test pins the location rule so that cannot happen silently again.
//
// Paths are literal (not joined) so the security lint rules stay quiet; vitest
// runs from the repo root, which the first test asserts.
// =====================================================

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const ENTRY = 'proxy.ts';

/** Files Next.js would consider a proxy/middleware entry point. */
const CANDIDATE_BASENAME = /^(middleware|proxy)\.(ts|js|mjs|mts|cjs|jsx|tsx)$/;

function isCandidate(name: string): boolean {
  return CANDIDATE_BASENAME.test(name);
}

describe('middleware wiring — entry point location', () => {
  test('vitest runs from the repo root and the App Router lives at the root', () => {
    expect(existsSync('package.json')).toBe(true);
    // If this ever fails because the app moved to src/app, the proxy must move
    // into src/ as well — see the location test below.
    expect(existsSync('app')).toBe(true);
    expect(existsSync('src/app')).toBe(false);
  });

  test('the entry point lives at the project root', () => {
    expect(existsSync(ENTRY)).toBe(true);
  });

  test('no entry-point candidate exists under src/', () => {
    expect(readdirSync('src').filter(isCandidate)).toEqual([]);
  });

  test('the project root holds exactly one candidate: proxy.ts', () => {
    expect(readdirSync('.').filter(isCandidate)).toEqual([ENTRY]);
  });

  test('the entry point is a default-exported proxy with a matcher config', () => {
    const source = readFileSync(ENTRY, 'utf8');

    expect(source).toMatch(/export default async function proxy\s*\(/);
    expect(source).toMatch(/export const config\s*=/);
    expect(source).toMatch(/matcher/);
  });

  test('the entry point does not export runtime (rejected in a proxy file)', () => {
    const source = readFileSync(ENTRY, 'utf8');

    // Next.js: "Route segment config is not allowed in Proxy file.
    // Proxy always runs on Node.js runtime."
    expect(source).not.toMatch(/export const runtime\s*=/);
  });

  test('the entry point is wired to the tenancy pipeline and the CSP layer', () => {
    const source = readFileSync(ENTRY, 'utf8');

    expect(source).toContain('runProxyPipeline');
    expect(source).toContain('NextResponse.rewrite');
    expect(source).toContain('applySecurityHeaders');
  });

  test('helper modules under src/lib/middleware are not entry-point candidates', () => {
    expect(existsSync('src/lib/middleware/proxyPipeline.ts')).toBe(true);
    expect(existsSync('src/lib/middleware/securityHeaders.ts')).toBe(true);
  });
});
