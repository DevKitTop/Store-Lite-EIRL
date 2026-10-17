import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';

export const runtime = 'nodejs';

function buildCsp(nonce: string, isDev: boolean) {
  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    ...(isDev ? ["'unsafe-eval'"] : []),
    'https://checkout.culqi.com',
    'https://*.culqi.com',
    'https://*.posthog.com',
    'https://connect.facebook.net',
    'https://*.facebook.net',
  ].join(' ');

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "img-src 'self' data: https: blob:",
    `script-src ${scriptSrc}`,
    "worker-src 'self' blob:",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "frame-src 'self' https://checkout.culqi.com https://*.culqi.com",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.culqi.com https://checkout.culqi.com https://*.culqi.com https://*.posthog.com https://graph.facebook.com https://www.facebook.com",
    'upgrade-insecure-requests',
  ]
    .join('; ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export async function middleware(request: NextRequest) {
  // Skip static assets and API routes entirely
  if (
    request.nextUrl.pathname.startsWith('/_next') ||
    request.nextUrl.pathname.startsWith('/api') ||
    request.nextUrl.pathname.startsWith('/static') ||
    request.nextUrl.pathname.includes('.')
  ) {
    return NextResponse.next();
  }

  const nonce = Buffer.from(randomUUID()).toString('base64');
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set(
    'Content-Security-Policy',
    buildCsp(nonce, process.env.NODE_ENV !== 'production'),
  );

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  response.headers.set('x-nonce', nonce);
  response.headers.set(
    'Content-Security-Policy',
    buildCsp(nonce, process.env.NODE_ENV !== 'production'),
  );

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
            response.cookies.set(name, value, options);
          });
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // No user - allow public pages to render
  if (!user) {
    return response;
  }

  // User authenticated: check for selected business cookie
  const selectedSlug = request.cookies.get('selected_business_slug')?.value;

  // If on root "/" and has selected business → go directly to business
  if (request.nextUrl.pathname === '/' && selectedSlug) {
    return NextResponse.redirect(new URL(`/${selectedSlug}`, request.url));
  }

  // If on root "/" without business → onboarding
  if (request.nextUrl.pathname === '/') {
    return NextResponse.redirect(new URL('/onboarding', request.url));
  }

  // If on "/list-business" and has selected business → go directly to business
  if (request.nextUrl.pathname === '/list-business' && selectedSlug) {
    return NextResponse.redirect(new URL(`/${selectedSlug}`, request.url));
  }

  // Other paths - continue normally
  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    '/((?!_next/static|_next/image|favicon.ico|public/).*)',
  ],
};
