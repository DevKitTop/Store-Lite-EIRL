// =====================================================
// SUPABASE PROXY CLIENT — ⚠️ NOT WIRED INTO THE MIDDLEWARE
// =====================================================
// Status: UNUSED by the running app. Nothing imports updateProxy except its
// own unit test. Kept because it encodes route-protection rules that were
// deliberately NOT adopted yet (see below).
//
// Why it is not wired: `updateProxy` blocks every unauthenticated request that
// is not on its internal allow-list. That allow-list does not cover guest
// storefront flows that exist in app/[slug] — /{slug}/order/verify/[orderNumber],
// /{slug}/ayuda, /{slug}/soporte and /{slug}/chat. Enabling it as-is would
// redirect anonymous customers trying to verify an order to /auth.
//
// The active session layer lives in src/middleware.ts and relies on per-route
// layouts for authorization (defense in depth, stricter than this list).
// Adopting updateProxy requires an explicit decision about which storefront
// routes are public. Until then this file must stay importable-but-unused.
//
// ⚠️ The unit tests for this file prove the RULES are correct; they do NOT
// prove it runs. Do not read a green suite as coverage of live behavior.
// =====================================================
// Description: Supabase client for Next.js proxy
// Usage: (currently none) — was imported from '@/lib/supabase/proxy'
// =====================================================

import { env } from '@/config/env';
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Handles proxy operations
 * Handles session refresh and cookie management
 */
export async function updateProxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'Missing Supabase environment variables. Please set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in your .env file.',
    );
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        // Propagate cookies to request (solo value, no necesita options)
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));

        // Update response to include mutated request so server components see the refreshed token
        supabaseResponse = NextResponse.next({
          request,
        });

        // Propagate cookies to response for the browser.
        // Apply shared cookie domain for cross-subdomain auth when set.
        // Cuando FEATURE_SUBDOMAIN_REWRITE está activo, las cookies de sesión
        // deben compartirse entre subdominios (slug.localhost → slug.localhost).
        // Sin esto, Supabase crea cookies host-only y la sesión se pierde al
        // navegar entre subdominios.
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(
            name,
            value,
            env.sharedCookieDomain ? { ...options, domain: env.sharedCookieDomain } : options,
          ),
        );
      },
    },
  });

  // IMPORTANT: Avoid writing any logic between createServerClient and
  // supabase.auth.getUser().

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const pathname = request.nextUrl.pathname;
    const isAuthPage = pathname.startsWith('/auth');
    const isCustomerAuthPopup = pathname === '/auth/customer';
    const isCreatePage = pathname.startsWith('/created');
    const isListPage = pathname.startsWith('/list-business');
    const isPricingPage = pathname.startsWith('/pricing');

    // Identify public storefront paths like /[slug], /[slug]/product/[id] or /[slug]/order/[token]
    const pathSegments = pathname.split('/').filter(Boolean);
    const isStorefrontBase =
      pathSegments.length === 1 &&
      !['auth', 'created', 'list-business', 'pricing'].includes(pathSegments[0]);
    const isProductDetail = pathSegments.length === 3 && pathSegments[1] === 'product';
    const isOrderTracking = pathSegments.length === 3 && pathSegments[1] === 'order';
    const isLegalPage =
      pathSegments.length === 2 &&
      ['terminos', 'devoluciones', 'libro-reclamaciones', 'privacidad'].includes(pathSegments[1]);
    const isPublicStorefront =
      isStorefrontBase || isProductDetail || isOrderTracking || isLegalPage;

    // Las API routes son server-side y manejan su propia autorización.
    // El proxy no debe interceptarlas — permite que requests del storefront
    // público (ej: validación de carrito sin sesión) lleguen al handler.
    const isApiRoute = pathname.startsWith('/api/');

    // Helper to return redirects while preserving refreshed cookies.
    // NOTA: supabaseResponse.cookies.getAll() devuelve solo name/value sin options.
    // Aplicamos sharedCookieDomain manualmente para mantener consistencia cross-subdominio.
    const redirectWithCookies = (url: URL) => {
      const redirectResponse = NextResponse.redirect(url);
      supabaseResponse.cookies.getAll().forEach((cookie) => {
        if (env.sharedCookieDomain) {
          redirectResponse.cookies.set(cookie.name, cookie.value, {
            domain: env.sharedCookieDomain,
          });
        } else {
          redirectResponse.cookies.set(cookie.name, cookie.value);
        }
      });
      return redirectResponse;
    };

    const isRootPage = pathname === '/';

    // Handle unauthenticated users
    // /pricing is public: it carries the platform's commercial metadata
    // and must be crawlable without a session (see sitemap + SEO batch).
    if (
      !user &&
      !isAuthPage &&
      !isPublicStorefront &&
      !isRootPage &&
      !isApiRoute &&
      !isPricingPage
    ) {
      const url = request.nextUrl.clone();
      url.pathname = '/auth';
      return redirectWithCookies(url);
    }

    // Handle authenticated users on auth page (EXCEPT /auth/customer popup).
    // /auth/customer is designed to handle already-authenticated users by sending
    // existing tokens via postMessage to the storefront popup opener. Redirecting it
    // would break the flow — the popup would show the user's own business instead.
    if (user && isAuthPage && !isCustomerAuthPopup) {
      const url = request.nextUrl.clone();
      url.pathname = '/';
      return redirectWithCookies(url);
    }

    // Handle business redirection for authenticated users
    if (user && !isCreatePage && !isListPage && !isPricingPage && pathname === '/') {
      const { data: userBusinesses, error } = await supabase
        .from('businesses')
        .select('id')
        .eq('owner_id', user.id);

      if (!error) {
        const url = request.nextUrl.clone();
        // Always redirect to /onboarding — the page checks user state
        // and shows relevant options (create business, join team, go to list)
        url.pathname = '/onboarding';
        return redirectWithCookies(url);
      }
    }
  } catch (error) {
    // Gracefully handle fetch failures in proxy/edge runtime
    console.error('Supabase Auth error in Proxy:', error);
  }

  return supabaseResponse;
}
