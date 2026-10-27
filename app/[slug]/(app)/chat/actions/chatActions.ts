'use server';

import { db } from '@/core/database/client';
import { businesses, businessTeamMembers, chatSessions, messages } from '@/core/database/schema';
import { notifyNewMessage } from '@/lib/notifications';
import { checkPermission } from '@/lib/permissions';
import { createClient } from '@/lib/supabase/server';
import { and, desc, eq } from 'drizzle-orm';

async function getAuthenticatedUserId() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user?.id ?? null;
}

async function resolveSessionActor(sessionId: string, guestId?: string) {
  const session = await db.query.chatSessions.findFirst({
    where: eq(chatSessions.id, sessionId),
    columns: { id: true, businessId: true, guestId: true },
  });

  if (!session) {
    return { allowed: false as const, reason: 'Sesion no encontrada' };
  }

  const userId = await getAuthenticatedUserId();
  if (userId) {
    const business = await db.query.businesses.findFirst({
      where: eq(businesses.id, session.businessId),
      columns: { id: true, ownerId: true },
    });

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

    // Deduplicate: keep only the latest session per guestId
    // Si un guest tiene varias sesiones, priorizar la que tiene paymentId (orden)
    // sobre la más reciente sin orden, para que el vendedor vea el contexto de compra.
    const seen = new Map<string, (typeof rawSessions)[number]>();
    for (const session of rawSessions) {
      const existing = seen.get(session.guestId);
      if (!existing) {
        seen.set(session.guestId, session);
      } else if (session.paymentId && !existing.paymentId) {
        // La nueva sesión TIENE orden y la existente NO → reemplazar
        seen.set(session.guestId, session);
      } else if (!session.paymentId && existing.paymentId) {
        // La existente ya tiene orden, mantenerla
        continue;
      } else if (session.createdAt! > existing.createdAt!) {
        // Ambas tienen (o ninguna) orden, quedarse con la más reciente
        seen.set(session.guestId, session);
      }
    }
    const sessions = Array.from(seen.values());

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
