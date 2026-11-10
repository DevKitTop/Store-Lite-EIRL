/**
 * Sentry Context Helper
 *
 * Attaches user identification and business context to Sentry events via
 * tags. Called at the top of server actions and API routes, and from the
 * authenticated layout so every render is tagged too.
 *
 * Only opaque identifiers and the plan name become tags. Never e-mail
 * addresses, tokens or credentials: tags are indexed and long-lived, so a
 * leaked secret there is not revocable.
 */

import { setTag, setUser } from '@sentry/nextjs';

import type { AnalyticsContext } from '@/lib/analytics/context';

interface SentryUser {
  id: string;
  email?: string;
}

interface SentryBusiness {
  id: string;
  plan?: string;
}

export interface SentryScopeTags {
  business_id?: string;
  plan: string;
  route?: string;
}

export interface SentryScope {
  user: { id: string } | null;
  tags: SentryScopeTags;
}

/**
 * Pure projection of the analytics context onto a Sentry scope.
 * Kept pure so the exact tag set is testable without an SDK.
 */
export function buildSentryScope(context: AnalyticsContext, route?: string): SentryScope {
  const tags: SentryScopeTags = { plan: context.plan };

  if (context.businessId) {
    tags.business_id = context.businessId;
  }

  if (route) {
    tags.route = route;
  }

  return {
    user: context.userId ? { id: context.userId } : null,
    tags,
  };
}

/**
 * Set Sentry context for the current request.
 * Call this at the top of server actions / API routes.
 * When no user is provided, clears user context and skips.
 */
export function setSentryContext(user: SentryUser | undefined, business?: SentryBusiness): void {
  if (!user) {
    return;
  }

  try {
    setUser({ id: user.id });

    if (business) {
      setTag('business_id', business.id);
      setTag('plan', business.plan ?? 'none');
    }
  } catch {
    // Sentry unavailable: keep serving the request.
  }
}

/**
 * Applies an already-resolved analytics context to the current Sentry scope,
 * including the route. Telemetry must never break request handling.
 */
export function applySentryContext(context: AnalyticsContext, route?: string): void {
  const scope = buildSentryScope(context, route);

  try {
    if (scope.user) {
      setUser(scope.user);
    }

    for (const [key, value] of Object.entries(scope.tags)) {
      setTag(key, value);
    }
  } catch {
    // Sentry unavailable: keep serving the request.
  }
}
