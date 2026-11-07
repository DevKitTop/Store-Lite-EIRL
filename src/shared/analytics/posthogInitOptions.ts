// PostHog init options.
//
// Kept in a pure module so the storefront's analytics configuration can be
// unit-tested without booting the SDK.

export interface PostHogInitEnvironment {
  /** True in development, where the SDK talks to PostHog directly. */
  isDev: boolean;
  /** Configured PostHog host, when there is one. */
  host?: string;
}

export interface PostHogKeyEnvironment {
  NEXT_PUBLIC_POSTHOG_KEY?: string;
  NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN?: string;
}

/**
 * Resolves the PostHog project key from either environment variable name.
 *
 * The PostHog wizard started writing `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN`,
 * while the app read only `NEXT_PUBLIC_POSTHOG_KEY`. With only the new name
 * configured the SDK received no key and was never initialised, which looks
 * exactly like "analytics is broken": no error in production, no events.
 */
export function resolvePostHogKey(env: PostHogKeyEnvironment): string | undefined {
  return env.NEXT_PUBLIC_POSTHOG_KEY || env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN || undefined;
}

export function buildPostHogInitOptions({ isDev, host }: PostHogInitEnvironment) {
  return {
    // In dev: use direct URL to avoid proxy/rewrite issues causing JSON parse errors.
    // In prod: use the /ingest proxy so ad-blockers don't block posthog.com domains.
    api_host: isDev ? host || 'https://us.i.posthog.com' : '/ingest',
    ui_host: host || 'https://us.posthog.com',
    defaults: '2026-01-30' as const,
    capture_exceptions: true,

    // posthog-js downloads two extra bundles on top of the core SDK:
    // `recorder.js` (69 KB) and `surveys.js` (48 KB). Neither is used here:
    // the project has no surveys, and session recording is not part of the
    // analytics contract this app relies on. Keeping them costs ~117 KB of
    // third-party JavaScript on the first paint of every storefront page.
    disable_session_recording: true,
    disable_surveys: true,

    // Set explicitly on purpose. The project's remote configuration returns
    // `capturePerformance.web_vitals: false`, and the SDK follows the server
    // whenever this option is undefined. An object here overrides the remote
    // config, which is the only way to collect Core Web Vitals (LCP, INP, CLS)
    // from real visitors and answer "how fast is the storefront for users".
    // `network_timing` is kept because session replay already relies on it.
    capture_performance: { network_timing: true, web_vitals: true },

    debug: isDev,
  };
}
