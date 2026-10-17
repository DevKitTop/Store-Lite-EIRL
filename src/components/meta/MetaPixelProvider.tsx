'use client';

import { usePathname } from 'next/navigation';
import Script from 'next/script';
import { useEffect, useRef, useState } from 'react';

import { env } from '@/config/env';
import { getConsentState } from '@/lib/consent/consentClient';
import { trackPageView, trackViewContent } from '@/lib/meta/events';
import { initFbq } from '@/lib/meta/fbq';
import { isPlatformTrackingPage } from '@/lib/meta/tenantGuard';

const FB_EVENTS_URL = 'https://connect.facebook.net/en_US/fbevents.js';

/**
 * Meta's queue-only bootstrap: defines `window.fbq` as a command queue
 * WITHOUT injecting the loader script (that would double-load the library,
 * since the loader script below loads it separately). Commands pushed while
 * the library is still loading are replayed automatically on arrival.
 */
const FBQ_BASE_CODE = `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[]}(window,document,'script');`;

function currentPathname(pathname: string | null): string {
  return pathname ?? (typeof window !== 'undefined' ? window.location.pathname : '');
}

/**
 * Consent-gated Meta Pixel mount for platform pages only.
 *
 * SSR-safe: renders nothing until the client effect confirms an allowed page
 * with explicit consent and a configured Pixel ID — tenant stores and
 * `/auth/customer` never mount the pixel.
 *
 * Fires PageView on mount and on every subsequent route change, and
 * ViewContent while the path is under `/pricing`.
 */
export default function MetaPixelProvider() {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const [ready, setReady] = useState(false);
  const firedPathRef = useRef<string | null>(null);

  // Mount gate — decided once on the first client render, mirroring the
  // consent banner (same window.location source, same one-shot semantics).
  // The firing effect below re-checks the guard per pathname.
  useEffect(() => {
    if (getConsentState() !== 'accepted') return;
    if (!isPlatformTrackingPage(window.location.hostname, window.location.pathname)) return;
    if (!env.metaPixelId) return;
    setMounted(true);
  }, []);

  // Fires PageView on mount (first run) and on route changes; ViewContent
  // additionally when the path is under /pricing. Each path is re-guarded so
  // a client navigation away from platform pages never emits events.
  useEffect(() => {
    if (!mounted || !ready) return;
    const path = currentPathname(pathname);
    if (!isPlatformTrackingPage(window.location.hostname, path)) return;
    if (firedPathRef.current === null) {
      firedPathRef.current = path;
    } else if (firedPathRef.current === path) {
      return;
    } else {
      firedPathRef.current = path;
    }
    trackPageView();
    if (path.startsWith('/pricing')) {
      trackViewContent({ content_type: 'product', content_name: 'Plan' });
    }
  }, [mounted, ready, pathname]);

  if (!mounted) return null;

  return (
    <>
      <Script
        id="meta-pixel-base"
        strategy="afterInteractive"
        nonce={undefined}
        dangerouslySetInnerHTML={{ __html: FBQ_BASE_CODE }}
      />
      <Script
        id="meta-pixel-loader"
        strategy="afterInteractive"
        src={FB_EVENTS_URL}
        onLoad={() => {
          initFbq(env.metaPixelId);
          setReady(true);
        }}
      />
      <noscript>
        {/* eslint-disable-next-line @next/next/no-img-element -- Meta pixel noscript fallback requires a plain <img> (design D7) */}
        <img
          height="1"
          width="1"
          style={{ display: 'none' }}
          src={`https://www.facebook.com/tr?id=${env.metaPixelId}&ev=PageView&noscript=1`}
          alt=""
        />
      </noscript>
    </>
  );
}
