'use server';

import { env } from '@/config/env';
import { db } from '@/core/database/client';
import {
  businesses,
  businessTeamMembers,
  whatsappChannels,
  whatsappConversations,
  whatsappMessages,
} from '@/core/database/schema';
import {
  assertOutboundRateLimit,
  assertWithinServiceWindow,
} from '@/core/whatsapp/guards/whatsappSendGuards';
import { createClient } from '@/lib/supabase/server';
import { and, desc, eq } from 'drizzle-orm';

const YCLOUD_API_BASE = 'https://api.ycloud.com/v2';

async function getAuthenticatedUserId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

async function verifyBusinessAccess(businessId: string): Promise<boolean> {
  const userId = await getAuthenticatedUserId();
  if (!userId) return false;

  const business = await db.query.businesses.findFirst({
    where: eq(businesses.id, businessId),
    columns: { ownerId: true },
  });

  if (!business) return false;

  const isOwner = business.ownerId === userId;
  if (isOwner) return true;

  // Check team member permissions
  const membership = await db.query.businessTeamMembers.findFirst({
    where: and(
      eq(businessTeamMembers.businessId, businessId),
      eq(businessTeamMembers.userId, userId),
    ),
  });

  return !!membership;
}

async function getActiveChannel(businessId: string) {
  const channel = await db
    .select()
    .from(whatsappChannels)
    .where(and(eq(whatsappChannels.businessId, businessId), eq(whatsappChannels.isActive, true)))
    .limit(1);
  return channel[0] ?? null;
}

/**
 * Anti-spam guards (Meta quality rating), run before any outbound send.
 * Free-form text is only allowed inside the 24h customer-service window;
 * templates keep their own approval path. Every outbound send is rate limited.
 * Returns the first guard failure as a send-result-shaped error, or null.
 */
async function runSendQualityGuards(data: {
  conversationId: string;
  channelId: string;
  type: 'text' | 'template';
}): Promise<{ success: false; error: string; retryAfterSeconds?: number } | null> {
  if (data.type === 'text') {
    const windowCheck = await assertWithinServiceWindow(data.conversationId);
    if (!windowCheck.ok) {
      return {
        success: false,
        error:
          windowCheck.reason === 'NO_INBOUND'
            ? 'El cliente debe escribir primero'
            : 'Ventana de 24h expirada. Usá un template aprobado.',
      };
    }
  }

  const rateLimit = await assertOutboundRateLimit(data.channelId);
  if (!rateLimit.ok) {
    return {
      success: false,
      error: 'Límite de envíos alcanzado. Intentá más tarde.',
      retryAfterSeconds: rateLimit.retryAfterSeconds,
    };
  }
  return null;
}

export async function fetchWhatsAppConversations(businessId: string) {
  try {
    const hasAccess = await verifyBusinessAccess(businessId);
    if (!hasAccess) {
      return { success: false, error: 'No autorizado', conversations: [], channelId: null };
    }

    const channel = await getActiveChannel(businessId);
    if (!channel) {
      return { success: true, conversations: [], channelConnected: false, channelId: null };
    }

    const conversations = await db
      .select({
        id: whatsappConversations.id,
        channelId: whatsappConversations.channelId,
        customerPhone: whatsappConversations.customerPhone,
        customerName: whatsappConversations.customerName,
        metaBsuId: whatsappConversations.metaBsuId,
        status: whatsappConversations.status,
        lastMessageAt: whatsappConversations.lastMessageAt,
        createdAt: whatsappConversations.createdAt,
        lastMessage: {
          id: whatsappMessages.id,
          body: whatsappMessages.body,
          direction: whatsappMessages.direction,
          type: whatsappMessages.type,
          status: whatsappMessages.status,
          createdAt: whatsappMessages.createdAt,
        },
      })
      .from(whatsappConversations)
      .leftJoin(
        whatsappMessages,
        and(
          eq(whatsappMessages.conversationId, whatsappConversations.id),
          eq(whatsappMessages.channelId, channel.id),
        ),
      )
      .where(
        and(
          eq(whatsappConversations.channelId, channel.id),
          eq(whatsappConversations.status, 'active'),
        ),
      )
      .orderBy(desc(whatsappConversations.lastMessageAt));

    // Deduplicate: one conversation per customer (by metaBsuId or phone)
    const seen = new Map<string, (typeof conversations)[number]>();
    for (const conv of conversations) {
      const key = conv.metaBsuId ?? conv.customerPhone;
      const existing = seen.get(key);
      const convTime = conv.lastMessageAt ? new Date(conv.lastMessageAt).getTime() : 0;
      const existingTime = existing?.lastMessageAt ? new Date(existing.lastMessageAt).getTime() : 0;
      if (!existing || convTime > existingTime) {
        seen.set(key, conv);
      }
    }

    // Expose the active channel id even with ZERO conversations so the client
    // can reach channel-scoped features (template manager) on fresh connects.
    return {
      success: true,
      conversations: Array.from(seen.values()),
      channelConnected: true,
      channelId: channel.id,
    };
  } catch (error) {
    console.error('Error fetching WhatsApp conversations:', error);
    return {
      success: false,
      error: 'No se pudo cargar las conversaciones de WhatsApp',
      conversations: [],
      channelId: null,
    };
  }
}

export async function fetchWhatsAppMessages(conversationId: string) {
  try {
    const userId = await getAuthenticatedUserId();
    if (!userId) {
      return { success: false, error: 'No autorizado', messages: [] };
    }

    // Verify the conversation belongs to a channel the user has access to
    const conv = await db
      .select({
        id: whatsappConversations.id,
        channelId: whatsappConversations.channelId,
        businessId: whatsappChannels.businessId,
      })
      .from(whatsappConversations)
      .innerJoin(whatsappChannels, eq(whatsappChannels.id, whatsappConversations.channelId))
      .where(eq(whatsappConversations.id, conversationId))
      .limit(1);

    if (!conv.length) {
      return { success: false, error: 'Conversación no encontrada', messages: [] };
    }

    const hasAccess = await verifyBusinessAccess(conv[0].businessId);
    if (!hasAccess) {
      return { success: false, error: 'No autorizado', messages: [] };
    }

    const messages = await db
      .select()
      .from(whatsappMessages)
      .where(eq(whatsappMessages.conversationId, conversationId))
      .orderBy(whatsappMessages.createdAt);

    return { success: true, messages };
  } catch (error) {
    console.error('Error fetching WhatsApp messages:', error);
    return { success: false, error: 'No se pudo cargar los mensajes', messages: [] };
  }
}

export async function sendWhatsAppMessage(data: {
  conversationId: string;
  channelId: string;
  type: 'text' | 'template';
  templateName?: string;
  body: string;
}) {
  try {
    const userId = await getAuthenticatedUserId();
    if (!userId) {
      return { success: false, error: 'No autorizado' };
    }

    // Verify the channel belongs to a business the user has access to
    const channel = await db
      .select({
        id: whatsappChannels.id,
        businessId: whatsappChannels.businessId,
        ycloudPhoneNumberId: whatsappChannels.ycloudPhoneNumberId,
        displayPhoneNumber: whatsappChannels.displayPhoneNumber,
      })
      .from(whatsappChannels)
      .where(eq(whatsappChannels.id, data.channelId))
      .limit(1);

    if (!channel.length) {
      return { success: false, error: 'Canal no encontrado' };
    }

    const hasAccess = await verifyBusinessAccess(channel[0].businessId);
    if (!hasAccess) {
      return { success: false, error: 'No autorizado' };
    }

    // Verify conversation belongs to this channel
    const conv = await db
      .select({
        id: whatsappConversations.id,
        channelId: whatsappConversations.channelId,
        customerPhone: whatsappConversations.customerPhone,
      })
      .from(whatsappConversations)
      .where(
        and(
          eq(whatsappConversations.id, data.conversationId),
          eq(whatsappConversations.channelId, data.channelId),
        ),
      )
      .limit(1);

    if (!conv.length) {
      return { success: false, error: 'Conversación no encontrada' };
    }

    // Anti-spam guards: fail fast before hitting the YCloud API.
    const guardError = await runSendQualityGuards({
      conversationId: data.conversationId,
      channelId: data.channelId,
      type: data.type,
    });
    if (guardError) return guardError;

    const apiKey = env.ycloudApiKey;
    if (!apiKey) {
      console.error('[sendWhatsAppMessage] Missing YCloud API key');
      return { success: false, error: 'Configuración de WhatsApp incompleta' };
    }

    // Prepare YCloud API request
    const ycloudPayload: Record<string, unknown> = {
      from: channel[0].ycloudPhoneNumberId,
      to: conv[0].customerPhone,
      type: data.type,
    };

    if (data.type === 'template') {
      ycloudPayload.template = { name: data.templateName };
    } else {
      ycloudPayload.text = { body: data.body };
    }

    const response = await fetch(`${YCLOUD_API_BASE}/whatsapp/messages/sendDirectly`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify(ycloudPayload),
    });

    const ycloudResponse = await response.json();

    if (!response.ok) {
      console.error('[sendWhatsAppMessage] YCloud error:', ycloudResponse);
      return {
        success: false,
        error: ycloudResponse.message || 'Error al enviar mensaje por WhatsApp',
      };
    }

    const ycloudMessageId = ycloudResponse.id;
    if (!ycloudMessageId) {
      console.error('[sendWhatsAppMessage] Invalid YCloud response:', ycloudResponse);
      return { success: false, error: 'Respuesta inválida de YCloud' };
    }

    // Store the message in our database
    const [newMessage] = await db
      .insert(whatsappMessages)
      .values({
        conversationId: data.conversationId,
        channelId: data.channelId,
        direction: 'outbound',
        type: data.type,
        templateName: data.templateName ?? null,
        body: data.body,
        ycloudMessageId,
        status: 'accepted',
      })
      .returning();

    // Update conversation's lastMessageAt
    await db
      .update(whatsappConversations)
      .set({ lastMessageAt: new Date(), updatedAt: new Date() })
      .where(eq(whatsappConversations.id, data.conversationId));

    return { success: true, message: newMessage };
  } catch (error) {
    console.error('Error sending WhatsApp message:', error);
    return { success: false, error: 'No se pudo enviar el mensaje' };
  }
}
