import {
  extractTenantSlugFromHost,
  getBusinessPath,
  getCanonicalBusinessUrl,
  isReservedSubdomain,
  isTenantHost,
  RESERVED_SUBDOMAINS,
} from '@/shared/utils/url';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// =====================================================
// URL HELPERS — Unit tests
// =====================================================
// By default FEATURE_SUBDOMAIN_REWRITE is undefined → false.
// Path-based mode is the default in all tests.
// Subdomain-mode tests mock env or window.location.
// =====================================================

// --- extractTenantSlugFromHost ---

describe('extractTenantSlugFromHost', () => {
  describe('production domains (≥3 parts)', () => {
    test('extracts slug from 3-part domain', () => {
      expect(extractTenantSlugFromHost('mi-tienda.store-lite.com')).toBe('mi-tienda');
    });

    test('returns slug for single-char slug', () => {
      expect(extractTenantSlugFromHost('a.store-lite.com')).toBe('a');
    });

    test('returns slug with numbers and hyphens', () => {
      expect(extractTenantSlugFromHost('tienda-123.store-lite.com')).toBe('tienda-123');
    });

    test('returns null for root domain (2 parts)', () => {
      expect(extractTenantSlugFromHost('store-lite.com')).toBeNull();
    });

    test('extracts www as subdomain (does NOT filter reserved — handled by isReservedSubdomain)', () => {
      expect(extractTenantSlugFromHost('www.store-lite.com')).toBe('www');
    });

    test('returns null for slug with underscore (invalid DNS)', () => {
      expect(extractTenantSlugFromHost('mi_tienda.store-lite.com')).toBeNull();
    });

    test('returns null for slug starting with hyphen', () => {
      expect(extractTenantSlugFromHost('-tienda.store-lite.com')).toBeNull();
    });

    test('returns null for slug ending with hyphen', () => {
      expect(extractTenantSlugFromHost('tienda-.store-lite.com')).toBeNull();
    });

    test('returns null for uppercase slug (regex is lowercase-only)', () => {
      expect(extractTenantSlugFromHost('MiTienda.store-lite.com')).toBeNull();
    });

    test('extracts first subdomain from deeply nested domain', () => {
      expect(extractTenantSlugFromHost('dev.mi-tienda.store-lite.com')).toBe('dev');
    });

    test('extracts first segment from IP-like address (127 IS a valid DNS subdomain label)', () => {
      // "127" is a valid DNS label — the function correctly extracts it.
      // This is not an IP address in hostname context.
      expect(extractTenantSlugFromHost('127.0.0.1')).toBe('127');
    });

    test('returns null for hostname with spaces', () => {
      expect(extractTenantSlugFromHost('mi tienda.store-lite.com')).toBeNull();
    });
  });

  describe('localhost development', () => {
    test('extracts slug from *.localhost (2 parts)', () => {
      expect(extractTenantSlugFromHost('mitienda.localhost')).toBe('mitienda');
    });

    test('handles *.localhost with port', () => {
      expect(extractTenantSlugFromHost('mitienda.localhost:3000')).toBe('mitienda');
    });

    test('returns null for bare localhost (1 part)', () => {
      expect(extractTenantSlugFromHost('localhost')).toBeNull();
    });

    test('returns null for localhost with port', () => {
      expect(extractTenantSlugFromHost('localhost:3000')).toBeNull();
    });
  });

  describe('port stripping', () => {
    test('strips port from production domain', () => {
      expect(extractTenantSlugFromHost('mi-tienda.store-lite.com:8080')).toBe('mi-tienda');
    });

    test('strips port from localhost domain', () => {
      expect(extractTenantSlugFromHost('myshop.localhost:3000')).toBe('myshop');
    });
  });

  describe('edge cases', () => {
    test('returns null for empty string', () => {
      expect(extractTenantSlugFromHost('')).toBeNull();
    });
  });
});

// --- isReservedSubdomain ---

describe('isReservedSubdomain', () => {
  test('returns true for all reserved subdomains', () => {
    const reserved: readonly string[] = RESERVED_SUBDOMAINS;
    for (const sub of reserved) {
      expect(isReservedSubdomain(sub), `${sub} should be reserved`).toBe(true);
    }
  });

  test('is case-insensitive', () => {
    expect(isReservedSubdomain('WWW')).toBe(true);
    expect(isReservedSubdomain('Api')).toBe(true);
    expect(isReservedSubdomain('ADMIN')).toBe(true);
  });

  test('returns false for non-reserved subdomains', () => {
    expect(isReservedSubdomain('mi-tienda')).toBe(false);
    expect(isReservedSubdomain('my-shop')).toBe(false);
    expect(isReservedSubdomain('store-123')).toBe(false);
  });

  test('returns false for empty string', () => {
    expect(isReservedSubdomain('')).toBe(false);
  });
});

// --- isTenantHost ---

describe('isTenantHost', () => {
  test('returns true for valid tenant subdomain', () => {
    expect(isTenantHost('mi-tienda.store-lite.com')).toBe(true);
  });

  test('returns true for *.localhost tenant', () => {
    expect(isTenantHost('mitienda.localhost')).toBe(true);
  });

  test('returns false for root domain (no subdomain)', () => {
    expect(isTenantHost('store-lite.com')).toBe(false);
  });

  test('returns false for reserved subdomain', () => {
    expect(isTenantHost('api.store-lite.com')).toBe(false);
    expect(isTenantHost('admin.store-lite.com')).toBe(false);
    expect(isTenantHost('www.store-lite.com')).toBe(false);
  });

  test('returns false for invalid slug format', () => {
    expect(isTenantHost('mi_tienda.store-lite.com')).toBe(false);
  });

  test('returns false for bare localhost', () => {
    expect(isTenantHost('localhost')).toBe(false);
    expect(isTenantHost('localhost:3000')).toBe(false);
  });
});

// --- getBusinessPath (path-based mode — default) ---

describe('getBusinessPath — path-based mode (default)', () => {
  test('/slug when no path', () => {
    expect(getBusinessPath('mi-tienda')).toBe('/mi-tienda');
  });

  test('/slug/path with leading slash', () => {
    expect(getBusinessPath('mi-tienda', '/dashboard')).toBe('/mi-tienda/dashboard');
  });

  test('/slug/path without leading slash', () => {
    expect(getBusinessPath('mi-tienda', 'dashboard')).toBe('/mi-tienda/dashboard');
  });

  test('/slug when empty string path', () => {
    expect(getBusinessPath('mi-tienda', '')).toBe('/mi-tienda');
  });

  test('/slug when root path "/"', () => {
    expect(getBusinessPath('mi-tienda', '/')).toBe('/mi-tienda');
  });

  test('handles nested paths', () => {
    expect(getBusinessPath('mi-tienda', '/product/abc/details')).toBe(
      '/mi-tienda/product/abc/details',
    );
  });
});

// --- getBusinessPath (subdomain mode — client-side) ---

describe('getBusinessPath — subdomain mode (client-side)', () => {
  const originalLocation = window.location;

  beforeEach(() => {
    process.env.FEATURE_SUBDOMAIN_REWRITE = 'true';
    vi.resetModules();
    // Override window.location to simulate tenant subdomain
    Object.defineProperty(window, 'location', {
      value: { hostname: 'mi-tienda.localhost' } as Location,
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    delete process.env.FEATURE_SUBDOMAIN_REWRITE;
    vi.resetModules();
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      configurable: true,
      writable: true,
    });
  });

  test('returns "" for root when hostname matches slug', async () => {
    const { getBusinessPath: fn } = await import('@/shared/utils/url');
    expect(fn('mi-tienda')).toBe('');
  });

  test('returns /dashboard when hostname matches slug', async () => {
    const { getBusinessPath: fn } = await import('@/shared/utils/url');
    expect(fn('mi-tienda', '/dashboard')).toBe('/dashboard');
  });

  test('handles path without leading slash', async () => {
    const { getBusinessPath: fn } = await import('@/shared/utils/url');
    expect(fn('mi-tienda', 'dashboard')).toBe('/dashboard');
  });

  test('returns /slug/path when hostname does NOT match slug', async () => {
    // hostname = mi-tienda.localhost, slug = otro-store → no match → path-based
    const { getBusinessPath: fn } = await import('@/shared/utils/url');
    expect(fn('otro-store', '/dashboard')).toBe('/otro-store/dashboard');
  });

  test('returns /slug when hostname does NOT match slug and no path', async () => {
    const { getBusinessPath: fn } = await import('@/shared/utils/url');
    expect(fn('otro-store')).toBe('/otro-store');
  });
});

// --- getCanonicalBusinessUrl (path-based mode — default) ---

describe('getCanonicalBusinessUrl — path-based mode (default)', () => {
  test('returns path-based URL without extra path', () => {
    expect(getCanonicalBusinessUrl('mi-tienda')).toBe('http://localhost:3000/mi-tienda');
  });

  test('returns path-based URL with path', () => {
    expect(getCanonicalBusinessUrl('mi-tienda', '/producto/123')).toBe(
      'http://localhost:3000/mi-tienda/producto/123',
    );
  });

  test('handles path without leading slash', () => {
    expect(getCanonicalBusinessUrl('mi-tienda', 'producto/123')).toBe(
      'http://localhost:3000/mi-tienda/producto/123',
    );
  });

  test('handles root path "/"', () => {
    expect(getCanonicalBusinessUrl('mi-tienda', '/')).toBe('http://localhost:3000/mi-tienda');
  });
});

// --- getCanonicalBusinessUrl (subdomain mode via env) ---

describe('getCanonicalBusinessUrl — subdomain mode', () => {
  beforeEach(() => {
    process.env.FEATURE_SUBDOMAIN_REWRITE = 'true';
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.FEATURE_SUBDOMAIN_REWRITE;
    vi.resetModules();
  });

  test('returns subdomain URL without extra path', async () => {
    const { getCanonicalBusinessUrl: fn } = await import('@/shared/utils/url');
    expect(fn('mi-tienda')).toBe('http://mi-tienda.localhost:3000');
  });

  test('returns subdomain URL with path', async () => {
    const { getCanonicalBusinessUrl: fn } = await import('@/shared/utils/url');
    expect(fn('mi-tienda', '/producto/123')).toBe('http://mi-tienda.localhost:3000/producto/123');
  });

  test('handles path without leading slash', async () => {
    const { getCanonicalBusinessUrl: fn } = await import('@/shared/utils/url');
    expect(fn('mi-tienda', 'producto/123')).toBe('http://mi-tienda.localhost:3000/producto/123');
  });

  test('handles root path "/"', async () => {
    const { getCanonicalBusinessUrl: fn } = await import('@/shared/utils/url');
    expect(fn('mi-tienda', '/')).toBe('http://mi-tienda.localhost:3000');
  });
});

// --- isAllowedAuthReturnOrigin (postMessage target allowlist) ---
// `env` is a module-scope literal, so every case stubs the env vars it needs
// and re-imports the module — same pattern as the subdomain-mode suites above.
// jsdom serves this suite from http://localhost:3000.

describe('isAllowedAuthReturnOrigin', () => {
  async function loadHelper(vars: Record<string, string> = {}) {
    // Flag off by default: the tenant branch is prepared but disabled.
    vi.stubEnv('FEATURE_SUBDOMAIN_REWRITE', '');
    for (const [key, value] of Object.entries(vars)) {
      vi.stubEnv(key, value);
    }
    vi.resetModules();
    const { isAllowedAuthReturnOrigin: fn } = await import('@/shared/utils/url');
    return fn;
  }

  test('allows the origin the popup itself is served from', async () => {
    const fn = await loadHelper({ NEXT_PUBLIC_AUTH_ORIGIN: 'https://storelite.app' });
    // Guards the assumption this suite's other assertions rest on.
    expect(window.location.origin).toBe('http://localhost:3000');
    expect(fn('http://localhost:3000/some/path')).toBe(true);
  });

  test('allows the configured auth origin', async () => {
    const fn = await loadHelper({ NEXT_PUBLIC_AUTH_ORIGIN: 'https://storelite.app' });
    expect(fn('https://storelite.app')).toBe(true);
    expect(fn('https://storelite.app/some/path')).toBe(true);
  });

  test('denies a foreign origin', async () => {
    const fn = await loadHelper({ NEXT_PUBLIC_AUTH_ORIGIN: 'https://storelite.app' });
    expect(fn('https://evil.example')).toBe(false);
    expect(fn('https://storelite.app.evil.example')).toBe(false);
    expect(fn('https://storelite.app:8443')).toBe(false);
  });

  test('denies non-URL and hostile-scheme inputs', async () => {
    const fn = await loadHelper({ NEXT_PUBLIC_AUTH_ORIGIN: 'https://storelite.app' });
    // eslint-disable-next-line sonarjs/code-eval -- hostile-scheme fixture, never executed
    expect(fn('javascript:alert(1)')).toBe(false);
    expect(fn('data:text/html,<script>alert(1)</script>')).toBe(false);
    expect(fn('relative/path')).toBe(false);
    expect(fn('')).toBe(false);
  });

  test('denies a tenant host while featureSubdomainRewrite is off', async () => {
    const fn = await loadHelper({ NEXT_PUBLIC_AUTH_ORIGIN: 'https://storelite.app' });
    expect(fn('https://acme.storelite.app')).toBe(false);
  });

  test('denies a foreign origin when NEXT_PUBLIC_AUTH_ORIGIN is unset', async () => {
    const fn = await loadHelper({ NEXT_PUBLIC_AUTH_ORIGIN: '' });
    expect(fn('https://evil.example')).toBe(false);
  });

  // --- R4: the env clause compares origins, not raw strings (design D6/D7) ---
  // A non-canonical NEXT_PUBLIC_AUTH_ORIGIN used to make the clause silently
  // dead, because a raw string never equals a parsed `origin`. Each case below
  // pins one spelling of the same origin.

  test('allows the configured auth origin written with a trailing slash', async () => {
    const fn = await loadHelper({ NEXT_PUBLIC_AUTH_ORIGIN: 'https://storelite.app/' });
    expect(fn('https://storelite.app')).toBe(true);
  });

  test('allows the configured auth origin written with a path', async () => {
    const fn = await loadHelper({ NEXT_PUBLIC_AUTH_ORIGIN: 'https://storelite.app/callback' });
    expect(fn('https://storelite.app')).toBe(true);
  });

  test('ignores host case in the configured auth origin', async () => {
    const fn = await loadHelper({ NEXT_PUBLIC_AUTH_ORIGIN: 'https://StoreLite.app' });
    expect(fn('https://storelite.app')).toBe(true);
  });

  test('ignores an explicit default port in the configured auth origin', async () => {
    const fn = await loadHelper({ NEXT_PUBLIC_AUTH_ORIGIN: 'https://storelite.app:443' });
    expect(fn('https://storelite.app')).toBe(true);
  });

  test('keeps a non-default port distinct instead of widening the allowlist', async () => {
    const fn = await loadHelper({ NEXT_PUBLIC_AUTH_ORIGIN: 'https://storelite.app:8443/cb' });
    // The port survives normalization, so this is the configured origin …
    expect(fn('https://storelite.app:8443')).toBe(true);
    // … and it does not pull the default-port origin into the allowlist.
    expect(fn('https://storelite.app')).toBe(false);
  });

  test('denies without throwing when the configured origin is unparseable', async () => {
    const fn = await loadHelper({ NEXT_PUBLIC_AUTH_ORIGIN: 'not a url' });
    expect(() => fn('https://evil.example')).not.toThrow();
    expect(fn('https://evil.example')).toBe(false);
  });

  test('denies without throwing when the configured origin is a hostile scheme', async () => {
    // eslint-disable-next-line sonarjs/code-eval -- hostile-scheme fixture, never executed
    const hostileOrigin = 'javascript:alert(1)';
    const fn = await loadHelper({ NEXT_PUBLIC_AUTH_ORIGIN: hostileOrigin });
    // The D6 guard: `new URL('javascript:alert(1)').origin` is the string 'null',
    // so normalizing the env without checking for it would ALLOW this origin.
    expect(() => fn(hostileOrigin)).not.toThrow();
    expect(fn(hostileOrigin)).toBe(false);
    expect(fn('https://storelite.app')).toBe(false);
  });

  test('allows a tenant host once featureSubdomainRewrite is on', async () => {
    const fn = await loadHelper({
      NEXT_PUBLIC_AUTH_ORIGIN: 'https://storelite.app',
      FEATURE_SUBDOMAIN_REWRITE: 'true',
    });
    expect(fn('https://acme.storelite.app')).toBe(true);
  });

  test('still denies a reserved subdomain when featureSubdomainRewrite is on', async () => {
    const fn = await loadHelper({
      NEXT_PUBLIC_AUTH_ORIGIN: 'https://storelite.app',
      FEATURE_SUBDOMAIN_REWRITE: 'true',
    });
    expect(fn('https://admin.storelite.app')).toBe(false);
  });
});
