'use server';

import { db } from '@/core/database/client';
import {
  businesses,
  businessTeamMembers,
  chatSessions,
  messages,
  payments,
} from '@/core/database/schema';
import { notifyNewMessage } from '@/lib/notifications';
import { verifyOrderAccessCookie } from '@/lib/orderAccessCookie';
import { checkPermission } from '@/lib/permissions';
import { getPostHogClient } from '@/lib/posthogServer';
import { createClient } from '@/lib/supabase/server';
import { and, desc, eq } from 'drizzle-orm';

async function getAuthenticatedUserId() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user?.id ?? null;
}

/**
 * Order-bound chat sessions (`session.paymentId != null`) are read/written by
 * the BUYER, whose only credential on the order page is the signed order-access
 * cookie (R19) — NOT a guessable `dni-{dni}` guestId. Reports whether the
 * current request carries a valid marker for the order behind that payment.
 *
 * The cookie is read server-side from the request, so no caller-supplied token
 * is needed: the tracking token is resolved from the session's own `paymentId`.
 */
async function hasOrderAccessCookie(paymentId: string): Promise<boolean> {
  const payment = await db.query.payments.findFirst({
    where: eq(payments.id, paymentId),
    columns: { trackingToken: true },
  });

  if (!payment?.trackingToken) return false;
  return verifyOrderAccessCookie(payment.trackingToken);
}

async function resolveSessionActor(sessionId: string, guestId?: string) {
  const session = await db.query.chatSessions.findFirst({
    where: eq(chatSessions.id, sessionId),
    columns: { id: true, businessId: true, guestId: true, paymentId: true },
  });

  if (!session) {
    return { allowed: false as const, reason: 'Sesion no encontrada' };
  }

  const userId = await getAuthenticatedUserId();
  if (userId) {
    const business = await db.query.businesses.findFirst({
      where: eq(businesses.id, session.businessId),
      columns: { ownerId: true },
    });

    // Check if user is owner
    if (business?.ownerId === userId) {
      return {
        allowed: true as const,
        role: 'store' as const,
        session,
        permissions: { canView: true, canRespond: true },
      };
    }

    // Check if user is team member with chat permission
    const membership = await db.query.businessTeamMembers.findFirst({
      where: and(
        eq(businessTeamMembers.businessId, session.businessId),
        eq(businessTeamMembers.userId, userId),
      ),
    });

    if (membership) {
      const canView = await checkPermission(session.businessId, userId, 'chat.view');
      const canRespond = await checkPermission(session.businessId, userId, 'chat.respond');

      if (canView || canRespond) {
        return {
          allowed: true as const,
          role: 'store' as const,
          session,
          permissions: { canView, canRespond },
        };
      }
    }

    // Check if the authenticated user is the guest of this session.
    // This happens when a business owner from business A chats as a
    // customer with business B — they're authenticated but NOT the
    // owner/team of business B, they're the guest.
    if (session.guestId === userId) {
      return { allowed: true as const, role: 'guest' as const, session };
    }
  }

  if (guestId && session.guestId === guestId) {
    // Order-bound sessions must ALSO prove order ownership: an order session's
    // guestId is `dni-{buyerDni}` — guessable — so a bare guestId match is not
    // proof of identity. The signed order-access cookie is.
    if (session.paymentId && !(await hasOrderAccessCookie(session.paymentId))) {
      return { allowed: false as const, reason: 'No autorizado' };
    }
    return { allowed: true as const, role: 'guest' as const, session };
  }

  return { allowed: false as const, reason: 'No autorizado' };
}

export async function startChatSession(data: {
  businessId: string;
  guestId: string;
  guestName: string;
  guestGender?: string;
  authUserId?: string;
  guestEmail?: string;
  guestAvatarUrl?: string;
}) {
  try {
    const business = await db.query.businesses.findFirst({
      where: eq(businesses.id, data.businessId),
      columns: { id: true, isActive: true },
    });

    if (!business) {
      return { success: false, error: 'Negocio no encontrado' };
    }

    if (!business.isActive) {
      return { success: false, error: 'El negocio no está activo en este momento' };
    }

    const existingSession = await db.query.chatSessions.findFirst({
      where: (table, { and, eq }) =>
        and(
          eq(table.businessId, data.businessId),
          eq(table.guestId, data.guestId),
          eq(table.status, 'active'),
        ),
      columns: { id: true },
      orderBy: (table, { desc }) => [desc(table.createdAt)],
    });

    if (existingSession) {
      return { success: true, sessionId: existingSession.id };
    }

    const [newSession] = await db
      .insert(chatSessions)
      .values({
        businessId: data.businessId,
        guestId: data.guestId,
        guestName: data.guestName,
        guestGender: data.guestGender ?? '',
        status: 'active',
        authUserId: data.authUserId ?? null,
        guestEmail: data.guestEmail ?? null,
        guestAvatarUrl: data.guestAvatarUrl ?? null,
      })
      .returning();

    if (!newSession) {
      throw new Error('Failed to create chat session');
    }

    await db.insert(messages).values({
      sessionId: newSession.id,
      isFromStore: true,
      content: `Hola ${data.guestName}. Bienvenido a nuestra tienda. En que podemos ayudarte hoy?`,
    });

    const posthog = getPostHogClient();
    if (posthog) {
      posthog.capture({
        distinctId: data.guestId,
        event: 'chat_session_started',
        properties: {
          business_id: data.businessId,
          session_id: newSession.id,
        },
      });
      await posthog.flush();
    }

    return { success: true, sessionId: newSession.id };
  } catch (error) {
    console.error('Error starting chat session:', error);
    return { success: false, error: 'No se pudo iniciar el chat' };
  }
}

export async function sendMessage(data: {
  sessionId: string;
  isFromStore?: boolean;
  guestId?: string;
  content: string;
  paymentId?: string;
}) {
  try {
    const actor = await resolveSessionActor(data.sessionId, data.guestId);
    if (!actor.allowed) {
      return { success: false, error: actor.reason };
    }

    if (actor.role === 'store' && actor.permissions && !actor.permissions.canRespond) {
      return { success: false, error: 'No tienes permiso para responder a los chats' };
    }

    const [newMessage] = await db
      .insert(messages)
      .values({
        sessionId: data.sessionId,
        paymentId: data.paymentId ?? null,
        isFromStore: actor.role === 'store',
        content: data.content,
      })
      .returning();

    // ─── Notificar al negocio si es mensaje de un cliente (guest) ───
    if (actor.role === 'guest') {
      const session = await db.query.chatSessions.findFirst({
        where: eq(chatSessions.id, data.sessionId),
        columns: { businessId: true, guestName: true },
      });

      if (session) {
        notifyNewMessage(session.businessId, {
          customerName: session.guestName,
          preview: data.content,
        }).catch((notifyErr) => {
          console.error('[notifyNewMessage] Error:', notifyErr);
        });
      }
    }

    return { success: true, message: newMessage };
  } catch (error) {
    console.error('Error sending message:', error);
    return { success: false, error: 'No se pudo enviar el mensaje' };
  }
}

export async function fetchMessages(sessionId: string, guestId?: string) {
  try {
    const actor = await resolveSessionActor(sessionId, guestId);
    if (!actor.allowed) {
      return { success: false, error: actor.reason, messages: [] };
    }

    const chatMessages = await db.query.messages.findMany({
      where: (table, { eq }) => eq(table.sessionId, sessionId),
      orderBy: (table, { asc }) => [asc(table.createdAt)],
    });

    return { success: true, messages: chatMessages };
  } catch (error) {
    console.error('Error fetching messages:', error);
    return { success: false, error: 'No se pudo cargar los mensajes', messages: [] };
  }
}

export async function getActiveChatSession(guestId: string, businessId: string) {
  try {
    const session = await db.query.chatSessions.findFirst({
      where: (table, { and, eq }) =>
        and(
          eq(table.guestId, guestId),
          eq(table.businessId, businessId),
          eq(table.status, 'active'),
        ),
      orderBy: (table, { desc }) => [desc(table.createdAt)],
    });

    // An order-bound session (paymentId != null) is enumerable by anyone who
    // knows a buyer DNI + a public businessId (`dni-{dni}` guestId), so it must
    // not be disclosed without the signed order-access cookie (R19).
    if (session?.paymentId && !(await hasOrderAccessCookie(session.paymentId))) {
      return { success: false, error: 'No autorizado' };
    }

    return { success: true, session };
  } catch (error) {
    console.error('Error getting active chat session:', error);
    return { success: false, error: 'No se pudo obtener la sesion actual' };
  }
}

export async function fetchChatSessions(businessId: string) {
  try {
    const userId = await getAuthenticatedUserId();
    if (!userId) {
      return { success: false, error: 'No autorizado', sessions: [] };
    }

    const business = await db.query.businesses.findFirst({
      where: eq(businesses.id, businessId),
      columns: { id: true, ownerId: true },
    });

    if (!business) {
      return { success: false, error: 'Negocio no encontrado', sessions: [] };
    }

    const isOwner = business.ownerId === userId;
    const hasPermission = isOwner || (await checkPermission(businessId, userId, 'chat.view'));

    if (!hasPermission) {
      return { success: false, error: 'No autorizado', sessions: [] };
    }

    const rawSessions = await db.query.chatSessions.findMany({
      where: eq(chatSessions.businessId, businessId),
      orderBy: [desc(chatSessions.createdAt)],
      with: {
        messages: {
          orderBy: [desc(messages.createdAt)],
          limit: 1,
          columns: {
            content: true,
            isFromStore: true,
            createdAt: true,
          },
        },
        payment: {
          columns: {
            id: true,
            orderNumber: true,
            amount: true,
            currency: true,
          },
        },
      },
    });

    // ⚠️ No deduplicamos por guestId. Con la migración de aislamiento,
    // cada orden tiene su propia sesión (paymentId) y un guestId distinto
    // (dni-{dni} o guest-{paymentId}). Si dos sesiones comparten guestId
    // es intencional (mismo comprador, órdenes separadas) — mostramos ambas.
    const sessions = rawSessions;

    return { success: true, sessions };
  } catch (error) {
    console.error('Error fetching chat sessions:', error);
    return { success: false, error: 'No se pudo cargar las sesiones de chat', sessions: [] };
  }
}

export async function deleteChatSession(sessionId: string) {
  try {
    const actor = await resolveSessionActor(sessionId);
    if (!actor.allowed || actor.role !== 'store') {
      return { success: false, error: 'No autorizado' };
    }

    const userId = await getAuthenticatedUserId();
    if (!userId) return { success: false, error: 'No autorizado' };

    const business = await db.query.businesses.findFirst({
      where: eq(businesses.id, actor.session.businessId),
      columns: { ownerId: true },
    });

    const isOwner = business?.ownerId === userId;
    const hasDeletePermission =
      isOwner || (await checkPermission(actor.session.businessId, userId, 'chat.delete'));

    if (!hasDeletePermission) {
      return { success: false, error: 'No tienes permiso para eliminar chats' };
    }

    await db.delete(chatSessions).where(eq(chatSessions.id, sessionId));
    return { success: true };
  } catch (error) {
    console.error('Error deleting chat session:', error);
    return { success: false, error: 'No se pudo eliminar el chat' };
  }
}
