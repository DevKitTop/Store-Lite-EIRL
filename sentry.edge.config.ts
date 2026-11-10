// This file configures the initialization of Sentry for edge features (middleware, edge routes, and so on).
// The config you add here will be used whenever one of the edge features is loaded.
// Note that this config is unrelated to the Vercel Edge Runtime and is also required when running locally.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import { resolveSentryRelease } from '@/lib/sentryRelease';
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Free tier: 5M spans/month — 10% sampling in production
  tracesSampleRate: 0.1,

  // Release tracking from the deployment that produced this build
  release: resolveSentryRelease(),
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,

  dataCollection: {
    // Disable automatic user data collection — we set context manually
    userInfo: false,
  },
});
