import { resolvePostHogKey } from '@/shared/analytics/posthogInitOptions';
import { PostHog } from 'posthog-node';

let posthogClient: PostHog | null = null;

export function getPostHogClient(): PostHog {
  if (!posthogClient) {
    const key = resolvePostHogKey({
      NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY,
      NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN,
    });
    const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;

    if (!key) {
      if (process.env.NODE_ENV !== 'production') {
        console.error(
          'NEXT_PUBLIC_POSTHOG_KEY (or NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN) variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once one of them is configured',
        );
      }
      // Return a no-op stub so callers don't need to guard
      return new PostHog('__missing__', {
        host: 'https://us.i.posthog.com',
        flushAt: 1,
        flushInterval: 0,
      });
    }

    posthogClient = new PostHog(key, {
      host: host ?? 'https://us.i.posthog.com',
      flushAt: 1,
      flushInterval: 0,
    });
  }
  return posthogClient;
}
