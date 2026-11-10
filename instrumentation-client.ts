// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import { resolveSentryRelease } from '@/lib/sentryRelease';
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: 'https://b6c1dc0143987d3b1c69b6a28a479ac8@o4511785250324480.ingest.us.sentry.io/4511785277063168',

  // Release + environment are what let Sentry answer "did this error appear
  // after the last deploy, and in which environment?". Undefined release
  // silently disables that correlation.
  release: resolveSentryRelease(),
  environment:
    process.env.NEXT_PUBLIC_VERCEL_ENV ??
    (process.env.NODE_ENV === 'production' ? 'production' : 'development'),

  // Add optional integrations for additional features
  integrations: [Sentry.replayIntegration()],

  // Define how likely traces are sampled. Adjust this value in production, or use tracesSampler for greater control.
  tracesSampleRate: 1,

  // Define how likely Replay events are sampled.
  // This sets the sample rate to be 10%. You may want this to be 100% while
  // in development and sample at a lower rate in production
  replaysSessionSampleRate: 0.1,

  // Define how likely Replay events are sampled when an error occurs.
  replaysOnErrorSampleRate: 1.0,

  dataCollection: {
    // To disable sending user data and HTTP bodies, uncomment the lines below. For more info visit:
    // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#dataCollection
    // userInfo: false,
    // httpBodies: [],
  },
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;

// ─── PostHog ───────────────────────────────────────────────────────────────
import {
  buildPostHogInitOptions,
  resolvePostHogEnvironment,
  resolvePostHogKey,
} from '@/shared/analytics/posthogInitOptions';
import posthog from 'posthog-js';

const POSTHOG_KEY = resolvePostHogKey({
  NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY,
  NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN,
});
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST;
const isDev = process.env.NODE_ENV === 'development';

if (!POSTHOG_KEY) {
  if (process.env.NODE_ENV !== 'production') {
    console.error(
      'NEXT_PUBLIC_POSTHOG_KEY (or NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN) variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once one of them is configured',
    );
  }
} else {
  posthog.init(POSTHOG_KEY, buildPostHogInitOptions({ isDev, host: POSTHOG_HOST }));

  // One PostHog project holds every environment. Tagging each event keeps
  // development, preview and production traffic separable inside that project
  // instead of splitting the data across projects nobody can compare.
  posthog.register({
    environment: resolvePostHogEnvironment({
      vercelEnv: process.env.NEXT_PUBLIC_VERCEL_ENV,
      hostname: window.location.hostname,
    }),
  });
}
