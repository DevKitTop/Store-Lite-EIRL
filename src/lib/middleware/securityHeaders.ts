// =====================================================
// SECURITY HEADERS (CSP + nonce)
// =====================================================
// Extracted from the middleware entry point so it can be unit-tested
// without booting a server. Consumed by src/middleware.ts only.
//
// WARNING: this module must NOT be named middleware.ts / proxy.ts.
// Next.js treats those filenames as entry points; a second file with one
// of those names silently competes with the real entry and can win.
// =====================================

import type { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';

/**
 * Per-request CSP nonce. Base64 of a random UUID: 48 chars of base64,
 * which is a valid CSP nonce source and cannot contain whitespace.
 */
export function createCspNonce(): string {
  return Buffer.from(randomUUID()).toString('base64');
}

/**
 * Content-Security-Policy for the app.
 *
 * `style-src 'unsafe-inline'` is intentionally retained: the storefront
 * injects a theme <style> tag built from business data, and inline style
 * attributes are used across the UI. Tightening it requires moving the
 * theme to a hashed/nonce'd stylesheet first.
 */
export interface CspOptions {
  /** Request scheme. `upgrade-insecure-requests` is only emitted over https. */
  protocol?: string;
}

export function buildCsp(nonce: string, isDev: boolean, options: CspOptions = {}): string {
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
    // Only meaningful over https. On a plain-http origin the browser upgrades
    // every same-origin request (including the /ingest capture POST) to https
    // and the request dies with ERR_SSL_PROTOCOL_ERROR before it is sent.
    ...(options.protocol === 'https:' ? ['upgrade-insecure-requests'] : []),
  ]
    .join('; ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Writes the nonce + CSP onto an outgoing response.
 *
 * The nonce must ALSO be forwarded as a request header so React Server
 * Components can read it via `headers()` and attach it to inline scripts.
 * That forwarding is the caller's job (see src/middleware.ts) because it
 * depends on how the response is created (next vs rewrite).
 */
export function applySecurityHeaders(
  response: NextResponse,
  options: { nonce: string; isDev: boolean; protocol?: string },
): void {
  response.headers.set('x-nonce', options.nonce);
  response.headers.set(
    'Content-Security-Policy',
    buildCsp(options.nonce, options.isDev, { protocol: options.protocol }),
  );
}
