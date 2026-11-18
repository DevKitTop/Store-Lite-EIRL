import type { MetadataRoute } from 'next';

import { SITE_DESCRIPTION, SITE_NAME } from '@/shared/utils/siteJsonLd';

// Mirrors the Material light theme: the splash background is the app surface
// and the chrome color is the primary token (src/styles/material-design/light.css).
const BACKGROUND_COLOR = '#ffffff';
const THEME_COLOR = '#216487';

/**
 * Web app manifest for the seller app shell.
 *
 * `start_url` and `scope` stay at the platform root on purpose: the proxy
 * routes "/" to the remembered business (or /onboarding) for authenticated
 * sellers and to the landing page for anonymous visitors. Pinning a tenant
 * slug here would break multi-business accounts and expired sessions.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: SITE_NAME,
    short_name: SITE_NAME,
    description: SITE_DESCRIPTION,
    lang: 'es',
    dir: 'ltr',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    display_override: ['standalone', 'minimal-ui'],
    background_color: BACKGROUND_COLOR,
    theme_color: THEME_COLOR,
    icons: [
      {
        src: '/img/pwa-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/img/pwa-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/img/pwa-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
