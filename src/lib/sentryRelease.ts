/**
 * Sentry Release Resolution
 *
 * One release name for every runtime (browser, Node server, edge), derived
 * from the deployment that produced the build.
 *
 * Release tracking is what answers "did this error appear after the last
 * deploy?". If the value resolves to undefined, Sentry cannot correlate an
 * error with a commit and that whole question becomes unanswerable.
 *
 * Priority:
 * 1. `NEXT_PUBLIC_SENTRY_RELEASE` — injected by next.config at build time so
 *    the value reaches the browser bundle too.
 * 2. `SENTRY_RELEASE` — explicit runtime override.
 * 3. `NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA` / `VERCEL_GIT_COMMIT_SHA` — Vercel.
 */

type EnvSource = Record<string, string | undefined>;

export function resolveSentryRelease(env: EnvSource = process.env): string | undefined {
  const candidates = [
    env.NEXT_PUBLIC_SENTRY_RELEASE,
    env.SENTRY_RELEASE,
    env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,
    env.VERCEL_GIT_COMMIT_SHA,
  ];

  for (const candidate of candidates) {
    const value = candidate?.trim();
    if (value) {
      return value;
    }
  }

  return undefined;
}
