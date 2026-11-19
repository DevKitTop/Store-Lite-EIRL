import { resolvePublicBusinessSlug } from '@/core/business/publicSlug';
import { db } from '@/core/database/client';
import { pushSubscriptions } from '@/core/database/schema';
import { logger } from '@/lib/logger';
import { getMemberPermissions } from '@/lib/permissions/checkPermission';
import { isJsonRequest, isSameOriginRequest } from '@/lib/security/csrf';
import { createClient } from '@/lib/supabase/server';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

/**
 * POST/DELETE /api/push/subscriptions
 *
 * Authenticated, CSRF-protected, idempotent management of the current user's
 * Web Push subscriptions. Endpoint and key material is capability data: it is
 * never logged and never echoed back to the client.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY_RE = /^[A-Za-z0-9_-]+={0,2}$/;
const MAX_ENDPOINT_LENGTH = 2048;
const MAX_KEY_LENGTH = 512;
const MAX_USER_AGENT_LENGTH = 512;

interface SubscriptionInput {
  endpoint: string;
  p256dh: string;
  auth: string;
  expirationTime: Date | null;
  userAgent: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

function isValidEndpoint(value: unknown): value is string {
  if (!isNonEmptyString(value, MAX_ENDPOINT_LENGTH)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:';
  } catch {
    return false;
  }
}

function parseExpirationTime(value: unknown): Date | null | undefined {
  if (value === undefined || value === null) return null;
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > Number.MAX_SAFE_INTEGER
  ) {
    return undefined;
  }
  return new Date(value);
}

function parseSubscription(body: Record<string, unknown>): SubscriptionInput | null {
  const subscription = body.subscription;
  if (!isRecord(subscription)) return null;
  if (!isValidEndpoint(subscription.endpoint)) return null;

  const keys = subscription.keys;
  if (!isRecord(keys)) return null;
  if (!isNonEmptyString(keys.p256dh, MAX_KEY_LENGTH) || !KEY_RE.test(keys.p256dh)) return null;
  if (!isNonEmptyString(keys.auth, MAX_KEY_LENGTH) || !KEY_RE.test(keys.auth)) return null;

  const expirationTime = parseExpirationTime(subscription.expirationTime);
  if (expirationTime === undefined) return null;

  return {
    endpoint: subscription.endpoint,
    p256dh: keys.p256dh,
    auth: keys.auth,
    expirationTime,
    userAgent: null,
  };
}

function parseEndpoint(body: Record<string, unknown>): string | null {
  return isValidEndpoint(body.endpoint) ? body.endpoint : null;
}

async function getAuthenticatedUserId(): Promise<string | NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }
  return user.id;
}

/**
 * Optional tenant context is validated but never stored or used to authorize
 * subscription ownership. A mismatch denies the request instead of silently
 * trusting client-supplied scope.
 */
async function validateTenantContext(
  body: Record<string, unknown>,
  userId: string,
): Promise<NextResponse | null> {
  const hasBusinessId = body.businessId !== undefined;
  const hasSlug = body.slug !== undefined;
  if (!hasBusinessId && !hasSlug) return null;
  if (hasBusinessId && hasSlug) {
    return NextResponse.json({ error: 'Contexto de negocio inválido' }, { status: 400 });
  }

  let businessId: string | null = null;
  if (hasBusinessId) {
    if (typeof body.businessId !== 'string' || !UUID_RE.test(body.businessId)) {
      return NextResponse.json({ error: 'Contexto de negocio inválido' }, { status: 400 });
    }
    businessId = body.businessId;
  } else {
    if (typeof body.slug !== 'string' || body.slug.length === 0 || body.slug.length > 200) {
      return NextResponse.json({ error: 'Contexto de negocio inválido' }, { status: 400 });
    }
    const resolved = await resolvePublicBusinessSlug(body.slug);
    businessId = resolved?.id ?? null;
  }

  if (!businessId) {
    return NextResponse.json({ error: 'Sin acceso al negocio' }, { status: 403 });
  }

  const { role } = await getMemberPermissions(businessId, userId);
  if (!role) {
    return NextResponse.json({ error: 'Sin acceso al negocio' }, { status: 403 });
  }
  return null;
}

function rejectsClientUserId(body: Record<string, unknown>, userId: string): boolean {
  return body.user_id !== undefined && body.user_id !== userId;
}

function databaseError(error: unknown, operation: string): NextResponse {
  // Never log the driver message: it can contain bound endpoint/key values.
  logger.error('[push subscriptions] database error', {
    name: error instanceof Error ? error.name : 'UnknownError',
    operation,
  });
  return NextResponse.json({ error: `No se pudo ${operation} la suscripción` }, { status: 500 });
}

async function readJsonBody(request: Request): Promise<Record<string, unknown> | NextResponse> {
  try {
    const body: unknown = await request.json();
    if (!isRecord(body)) {
      return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 });
    }
    return body;
  } catch {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 });
  }
}

export async function POST(request: Request) {
  const userId = await getAuthenticatedUserId();
  if (userId instanceof NextResponse) return userId;

  if (!isJsonRequest(request) || !isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Solicitud rechazada' }, { status: 403 });
  }

  const body = await readJsonBody(request);
  if (body instanceof NextResponse) return body;
  if (rejectsClientUserId(body, userId)) {
    return NextResponse.json({ error: 'Solicitud rechazada' }, { status: 403 });
  }

  const tenantError = await validateTenantContext(body, userId);
  if (tenantError) return tenantError;

  const subscription = parseSubscription(body);
  if (!subscription) {
    return NextResponse.json({ error: 'Suscripción inválida' }, { status: 400 });
  }

  const rawUserAgent = request.headers.get('user-agent');
  const userAgent =
    rawUserAgent && rawUserAgent.length <= MAX_USER_AGENT_LENGTH ? rawUserAgent : null;
  const { endpoint, p256dh, auth, expirationTime } = subscription;
  const now = new Date();

  try {
    const existing = await db
      .select({ id: pushSubscriptions.id })
      .from(pushSubscriptions)
      .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)))
      .limit(1);

    await db
      .insert(pushSubscriptions)
      .values({
        userId,
        endpoint,
        p256dh,
        auth,
        expirationTime,
        userAgent,
        updatedAt: now,
        lastSeenAt: now,
        revokedAt: null,
        invalidatedAt: null,
      })
      .onConflictDoUpdate({
        target: [pushSubscriptions.userId, pushSubscriptions.endpoint],
        set: {
          p256dh,
          auth,
          expirationTime,
          userAgent,
          updatedAt: now,
          lastSeenAt: now,
          revokedAt: null,
          invalidatedAt: null,
          // failure_count is intentionally retained: T2.4/T2.7 own its reset
          // policy, and resetting here would hide terminal provider failures.
        },
      })
      .returning({ id: pushSubscriptions.id });

    return NextResponse.json({
      ok: true,
      status: existing.length > 0 ? 'updated' : 'subscribed',
    });
  } catch (error) {
    return databaseError(error, 'registrar');
  }
}

export async function DELETE(request: Request) {
  const userId = await getAuthenticatedUserId();
  if (userId instanceof NextResponse) return userId;

  if (!isJsonRequest(request) || !isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Solicitud rechazada' }, { status: 403 });
  }

  const body = await readJsonBody(request);
  if (body instanceof NextResponse) return body;
  if (rejectsClientUserId(body, userId)) {
    return NextResponse.json({ error: 'Solicitud rechazada' }, { status: 403 });
  }

  const tenantError = await validateTenantContext(body, userId);
  if (tenantError) return tenantError;

  const endpoint = parseEndpoint(body);
  if (!endpoint) {
    return NextResponse.json({ error: 'Suscripción inválida' }, { status: 400 });
  }

  try {
    const updated = await db
      .update(pushSubscriptions)
      .set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)))
      .returning({ id: pushSubscriptions.id });

    return NextResponse.json({ ok: true, status: updated.length > 0 ? 'revoked' : 'noop' });
  } catch (error) {
    return databaseError(error, 'revocar');
  }
}
