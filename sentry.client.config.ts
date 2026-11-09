import { resolveSentryRelease } from '@/lib/sentryRelease';
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  debug: false,

  // Free tier: 50 replays/month — only on errors, never session-sampled
  replaysOnErrorSampleRate: 0.5,
  replaysSessionSampleRate: 0.0,

  // Release tracking from the deployment that produced this build
  release: resolveSentryRelease(),
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
});
