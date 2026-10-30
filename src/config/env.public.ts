/**
 * Client-safe configuration.
 *
 * Next.js only inlines `NEXT_PUBLIC_*` variables into the browser bundle, so
 * this module may only read names with that prefix. Everything here is safe to
 * ship to the browser.
 *
 * Server secrets and their fail-fast production validation live in
 * `src/config/env.ts`, which must never be reachable from a `'use client'`
 * module. `tests/unit/envClientBoundary.test.ts` enforces that boundary.
 */
export const publicEnv = {
  // Supabase — the anon key is designed to be public; Row Level Security is
  // what authorizes access on the server.
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  nextPublicAppUrl: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  // Allowed return origin for the customer auth popup (public — used by
  // isAllowedAuthReturnOrigin to validate postMessage targets).
  authOrigin: process.env.NEXT_PUBLIC_AUTH_ORIGIN || '',
  // Habilita el rewrite de subdominios en proxy.ts (Fase 2 de la migración a
  // subdominios). Shared URL helpers read it on both sides: it is the real
  // value on the server and `false` in the browser, because the variable is
  // not `NEXT_PUBLIC_` — the same asymmetry that exists today.
  featureSubdomainRewrite: process.env.FEATURE_SUBDOMAIN_REWRITE === 'true',
  // Meta Pixel + YCloud Embedded Signup public identifiers.
  metaPixelId: process.env.NEXT_PUBLIC_META_PIXEL_ID || '',
  ycloudFbAppId: process.env.NEXT_PUBLIC_YCLOUD_FB_APP_ID || '',
  ycloudFbConfigId: process.env.NEXT_PUBLIC_YCLOUD_FB_CONFIG_ID || '',
  ycloudFbSolutionId: process.env.NEXT_PUBLIC_YCLOUD_FB_SOLUTION_ID || '',
} as const;
