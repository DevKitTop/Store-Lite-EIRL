// =====================================================
// NEXT.JS PROXY — the single middleware entry point
// =====================================================
// ⚠️ THIS FILE MUST LIVE AT THE PROJECT ROOT.
//
// Next.js decides where to look for the proxy by where the App Router lives:
// because this project uses `app/` at the root (not `src/app`), the proxy is
// only picked up when it sits next to `app/`. A copy under `src/` is compiled
// but never registered, so it silently never runs — which is exactly what had
// been happening: the middleware lived at src/middleware.ts and had no effect
// in any environment. That is why there was no edge rate limiting, no CSP and
// no subdomain rewrite.
//
// Rules worth keeping:
//   1. Exactly one `proxy.ts` / `middleware.ts` in the repo, at the root.
//      tests/unit/middlewareWiring.test.ts fails if that stops being true.
//   2. Do NOT export `runtime` here — Next.js rejects route segment config in
//      a proxy file ("Proxy always runs on Node.js runtime").
//   3. Unit tests that import this function prove nothing about whether
//      Next.js calls it. Verify wiring empirically against a running server.
//
// Responsibilities, in order:
//   1. Skip static assets
//   2. Rate limiting + tenancy (delegated to lib/middleware/proxyPipeline)
//   3. CSP + nonce
//   4. Supabase session refresh + platform redirects
//   5. Storefront rewrite for tenant subdomains
// =====================================

import { env } from '@/config/env';
import { isPlatformOnlyPath, runProxyPipeline } from '@/lib/middleware/proxyPipeline';
import { buildLoginRedirectPath, isPublicStorefrontPath } from '@/lib/middleware/routeProtection';
import { applySecurityHeaders, buildCsp, createCspNonce } from '@/lib/middleware/securityHeaders';
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export default async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // ── 1. Static assets are left alone ────────────────────
  // NOTE: /api is intentionally NOT skipped here — it must pass through the
  // rate limiter below. It is short-circuited right after, before the CSP and
  // session layers, so API responses stay untouched.
  if (pathname.startsWith('/_next') || pathname.startsWith('/static') || pathname.includes('.')) {
    return NextResponse.next();
  }

  const isApiRequest = pathname.startsWith('/api');

  // ── 2. Rate limiting + tenancy ─────────────────────────
  // May mutate request.nextUrl.pathname when a tenant rewrite applies, so the
  // session layer below evaluates the internal /{slug}/... route.
  const outcome = runProxyPipeline(request);

  if (outcome.kind === 'rateLimited') {
    return new NextResponse(
      JSON.stringify({ error: 'Too many requests. Please try again later.' }),
      {
        status: 429,
        headers: {
          'Retry-After': String(outcome.retryAfterSeconds),
          'Content-Type': 'application/json',
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(outcome.resetAfterSeconds),
        },
      },
    );
  }

  if (outcome.kind === 'platformRedirect') {
    return NextResponse.redirect(outcome.location, 302);
  }

  const { rewriteUrl } = outcome;

  // API routes handle their own authorization server-side and must resolve at
  // /api/..., never /{slug}/api/... They skip CSP (JSON responses) and the
  // session refresh.
  if (isApiRequest) {
    return NextResponse.next();
  }

  // ── 3. CSP + nonce ─────────────────────────────────────
  const nonce = createCspNonce();
  const isDev = process.env.NODE_ENV !== 'production';

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', buildCsp(nonce, isDev));

  // Reading the nonce in the App Router requires forwarding the overridden
  // request headers; mutating `request` alone is not enough.
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  applySecurityHeaders(response, nonce, isDev);

  // ── 4. Session refresh + platform redirects ────────────
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value);
            // Shared cookie domain keeps the session alive across tenant
            // subdomains when the rewrite feature is enabled. Unset in most
            // environments, in which case cookies stay host-only.
            response.cookies.set(
              name,
              value,
              env.sharedCookieDomain ? { ...options, domain: env.sharedCookieDomain } : options,
            );
          });
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Logged-out visitors reach the public storefront; every other storefront
  // route bounces to login with a sanitized return URL (PR B's callback will
  // honour it). The pipeline above already rewrote the pathname for tenant
  // subdomains, so this gate evaluates the internal /{slug}/... route.
  // `/`, platform paths (/auth*, /pricing, /onboarding, ...) and /api/* keep
  // their existing behaviour.
  //
  // DENY-BY-DEFAULT (deliberate): this is an auth boundary, so the default is
  // closed — fail-closed beats fail-open here. An unknown multi-segment path
  // such as /beta/foo therefore lands on login (302) rather than 404: a future
  // seller surface stays protected even before anyone lists it in the
  // allow-list. Do NOT "fix" this into a 404.
  if (!user) {
    const loggedOutPathname = request.nextUrl.pathname;
    const mustRedirectToLogin =
      loggedOutPathname !== '/' &&
      !isPlatformOnlyPath(loggedOutPathname) &&
      !isPublicStorefrontPath(loggedOutPathname);

    if (mustRedirectToLogin) {
      const loginRedirect = NextResponse.redirect(
        new URL(buildLoginRedirectPath(request.nextUrl), request.url),
        302,
      );
      // The decision depends on the session cookie: never let a shared cache
      // store an auth redirect.
      loginRedirect.headers.set('Cache-Control', 'no-store');
      loginRedirect.headers.set('Vary', 'Cookie');
      copySessionCookies(response, loginRedirect);
      return loginRedirect;
    }

    return finishResponse({ sessionResponse: response, rewriteUrl, requestHeaders, nonce, isDev });
  }

  // Authenticated: honour the remembered business. On a tenant subdomain the
  // rewrite already turned "/" into "/{slug}", so these never fire there.
  const selectedSlug = request.cookies.get('selected_business_slug')?.value;

  if (request.nextUrl.pathname === '/' && selectedSlug) {
    return NextResponse.redirect(new URL(`/${selectedSlug}`, request.url));
  }

  if (request.nextUrl.pathname === '/') {
    return NextResponse.redirect(new URL('/onboarding', request.url));
  }

  if (request.nextUrl.pathname === '/list-business' && selectedSlug) {
    return NextResponse.redirect(new URL(`/${selectedSlug}`, request.url));
  }

  // ── 5. Storefront rewrite / normal pass-through ────────
  return finishResponse({ sessionResponse: response, rewriteUrl, requestHeaders, nonce, isDev });
}

/**
 * Returns the response that actually goes out.
 *
 * When a tenant rewrite applies we need a real rewrite — `NextResponse.next()`
 * does not change the route the App Router resolves, which is why storefront
 * subdomains used to land on the SaaS landing page. Refreshed session cookies
 * are carried over, and the shared cookie domain is re-applied because
 * `cookies.getAll()` drops the options.
 */
function finishResponse(context: {
  sessionResponse: NextResponse;
  rewriteUrl: URL | null;
  requestHeaders: Headers;
  nonce: string;
  isDev: boolean;
}): NextResponse {
  const { sessionResponse, rewriteUrl, requestHeaders, nonce, isDev } = context;

  if (!rewriteUrl || sessionResponse.status !== 200) {
    return sessionResponse;
  }

  const rewritten = NextResponse.rewrite(rewriteUrl, { request: { headers: requestHeaders } });

  copySessionCookies(sessionResponse, rewritten);

  applySecurityHeaders(rewritten, nonce, isDev);

  return rewritten;
}

/**
 * Carries refreshed session cookies from the session layer's response onto
 * another response (rewrite or redirect). Re-applies the shared cookie domain
 * because `cookies.getAll()` drops the options.
 */
function copySessionCookies(from: NextResponse, to: NextResponse): void {
  from.cookies.getAll().forEach((cookie) => {
    to.cookies.set(
      cookie.name,
      cookie.value,
      env.sharedCookieDomain ? { domain: env.sharedCookieDomain } : undefined,
    );
  });
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     * - static image extensions
     */
    '/((?!_next/static|_next/image|favicon.ico|public/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
