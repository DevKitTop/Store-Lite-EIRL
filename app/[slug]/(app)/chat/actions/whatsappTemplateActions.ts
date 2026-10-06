'use server';

import { env } from '@/config/env';
import { db } from '@/core/database/client';
import {
  businesses,
  whatsappChannels,
  whatsappTemplates,
} from '@/core/database/schema';
import {
  assertOutboundRateLimit,
  assertTemplateApproved,
} from '@/core/whatsapp/guards/whatsappSendGuards';
import { normalizeMetaStatus } from '@/core/whatsapp/templates/metaStatus';
import { BASE_TEMPLATES, applyBusinessName } from '@/features/chat/constants/baseTemplates';
import { createClient } from '@/lib/supabase/server';
import { and, desc, eq } from 'drizzle-orm';

const YCLOUD_API_BASE = 'https://api.ycloud.com/v2';

// ============================================================
// Types
// ============================================================

export interface WhatsAppTemplateData {
  channelId: string;
  name: string;
  category: 'marketing' | 'utility' | 'authentication';
  language: string;
  body: string;
  components?: {
    type: 'header' | 'body' | 'button' | 'footer';
    format?: 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT';
    text?: string;
    sub_type?: 'url' | 'quick_reply' | 'phone_number';
    url?: string;
  }[];
}

export interface CreateTemplateResult {
  success: boolean;
  template?: typeof whatsappTemplates.$inferSelect;
  error?: string;
  ycloudTemplateId?: string;
}

export interface FetchTemplatesResult {
  success: boolean;
  templates: (typeof whatsappTemplates.$inferSelect)[];
  error?: string;
}

export interface SyncTemplateResult {
  success: boolean;
  template?: typeof whatsappTemplates.$inferSelect;
  error?: string;
}

// ============================================================
// Auth Helpers
// ============================================================

async function getAuthenticatedUserId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

async function verifyChannelAccess(
  channelId: string,
): Promise<{ businessId: string; hasAccess: boolean }> {
  const userId = await getAuthenticatedUserId();
  if (!userId) return { businessId: '', hasAccess: false };

  const channel = await db
    .select({
      id: whatsappChannels.id,
      businessId: whatsappChannels.businessId,
    })
    .from(whatsappChannels)
    .where(eq(whatsappChannels.id, channelId))
    .limit(1);

  if (!channel.length) return { businessId: '', hasAccess: false };

  const business = await db
    .select({ ownerId: businesses.ownerId })
    .from(businesses)
    .where(eq(businesses.id, channel[0].businessId))
    .limit(1);

  if (!business.length) return { businessId: channel[0].businessId, hasAccess: false };

  const isOwner = business[0].ownerId === userId;
  if (isOwner) return { businessId: channel[0].businessId, hasAccess: true };

  // Check team member (simplified - in production would check permissions)
  return { businessId: channel[0].businessId, hasAccess: isOwner };
}

// ============================================================
// Server Actions
// ============================================================

/**
 * Create a WhatsApp template via YCloud API and store it locally with metaStatus: 'pending'
 */
export async function createWhatsAppTemplate(
  data: WhatsAppTemplateData,
): Promise<CreateTemplateResult> {
  try {
    const { channelId, name, category, language, body, components } = data;

    // Verify channel access
    const { hasAccess } = await verifyChannelAccess(channelId);
    if (!hasAccess) {
      return { success: false, error: 'No autorizado para este canal' };
    }

    const apiKey = env.ycloudApiKey;
    if (!apiKey) {
      console.error('[createWhatsAppTemplate] Missing YCloud API key');
      return { success: false, error: 'Configuración de WhatsApp incompleta' };
    }

    // Prepare YCloud API request
    const ycloudPayload = {
      name,
      category,
      language,
      components:
        components?.map((comp) => {
          const base = { type: comp.type };
          if (comp.type === 'header') {
            return { ...base, format: comp.format || 'TEXT' };
          }
          if (comp.type === 'body') {
            return { ...base, text: comp.text || body };
          }
          if (comp.type === 'button') {
            return { ...base, sub_type: comp.sub_type || 'url', text: comp.text, url: comp.url };
          }
          return base;
        }) ?? [],
    };

    const response = await fetch(`${YCLOUD_API_BASE}/whatsapp/templates`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify(ycloudPayload),
    });

    const ycloudResponse = await response.json();

    if (!response.ok) {
      console.error('[createWhatsAppTemplate] YCloud error:', ycloudResponse);
      return {
        success: false,
        error: ycloudResponse.message || 'Error al crear template en YCloud',
      };
    }

    const metaTemplateId = ycloudResponse.id;
    if (!metaTemplateId) {
      console.error('[createWhatsAppTemplate] Invalid YCloud response:', ycloudResponse);
      return { success: false, error: 'Respuesta inválida de YCloud' };
    }

    // Store in local database with pending status
    const [newTemplate] = await db
      .insert(whatsappTemplates)
      .values({
        channelId,
        name,
        category,
        language,
        body,
        metaStatus: 'pending',
        metaTemplateId,
      })
      .returning();

    return { success: true, template: newTemplate, ycloudTemplateId: metaTemplateId };
  } catch (error) {
    console.error('[createWhatsAppTemplate] Error:', error);
    return { success: false, error: 'No se pudo crear el template' };
  }
}

/**
 * Create template from a base template (pre-defined) with business name substitution
 */
export async function createTemplateFromBase(
  channelId: string,
  baseTemplateName: string,
  businessName: string,
): Promise<CreateTemplateResult> {
  const baseTemplate = BASE_TEMPLATES.find((t) => t.name === baseTemplateName);
  if (!baseTemplate) {
    return { success: false, error: `Base template '${baseTemplateName}' no encontrado` };
  }

  const templateWithBusiness = applyBusinessName(baseTemplate, businessName);

  return createWhatsAppTemplate({
    channelId,
    name: templateWithBusiness.name,
    category: templateWithBusiness.category,
    language: templateWithBusiness.language,
    body: templateWithBusiness.body,
    components: templateWithBusiness.components,
  });
}

/**
 * Fetch all templates for a channel (with metaStatus)
 */
export async function fetchWhatsAppTemplates(channelId: string): Promise<FetchTemplatesResult> {
  try {
    const { hasAccess } = await verifyChannelAccess(channelId);
    if (!hasAccess) {
      return { success: false, error: 'No autorizado', templates: [] };
    }

    const templates = await db
      .select()
      .from(whatsappTemplates)
      .where(eq(whatsappTemplates.channelId, channelId))
      .orderBy(desc(whatsappTemplates.createdAt));

    return { success: true, templates };
  } catch (error) {
    console.error('[fetchWhatsAppTemplates] Error:', error);
    return { success: false, error: 'No se pudieron cargar los templates', templates: [] };
  }
}

/**
 * Sync template status from YCloud (GET /v2/whatsapp/templates/{id})
 */
export async function syncTemplateStatus(templateId: string): Promise<SyncTemplateResult> {
  try {
    // First get the template from local DB
    const [template] = await db
      .select()
      .from(whatsappTemplates)
      .where(eq(whatsappTemplates.id, templateId))
      .limit(1);

    if (!template) {
      return { success: false, error: 'Template no encontrado' };
    }

    // Verify access (channelId is required for non-global templates)
    if (!template.channelId) {
      return { success: false, error: 'Template no tiene canal asociado' };
    }
    const { hasAccess } = await verifyChannelAccess(template.channelId);
    if (!hasAccess) {
      return { success: false, error: 'No autorizado' };
    }

    const apiKey = env.ycloudApiKey;
    if (!apiKey) {
      return { success: false, error: 'Configuración de WhatsApp incompleta' };
    }

    // Fetch from YCloud using metaTemplateId
    if (!template.metaTemplateId) {
      return { success: false, error: 'Template no tiene metaTemplateId' };
    }

    const response = await fetch(
      `${YCLOUD_API_BASE}/whatsapp/templates/${template.metaTemplateId}`,
      {
        method: 'GET',
        headers: {
          'X-API-Key': apiKey,
        },
      },
    );

    const ycloudResponse = await response.json();

    if (!response.ok) {
      console.error('[syncTemplateStatus] YCloud error:', ycloudResponse);
      return { success: false, error: 'Error al sincronizar con YCloud' };
    }

    // YCloud returns UPPERCASE statuses ('APPROVED') — persist lowercase.
    const metaStatus = normalizeMetaStatus(ycloudResponse.status);

    // Update local status
    const [updated] = await db
      .update(whatsappTemplates)
      .set({
        metaStatus,
        updatedAt: new Date(),
      })
      .where(eq(whatsappTemplates.id, templateId))
      .returning();

    return { success: true, template: updated };
  } catch (error) {
    console.error('[syncTemplateStatus] Error:', error);
    return { success: false, error: 'No se pudo sincronizar el template' };
  }
}

/**
 * Get only approved templates for a channel (for use in sending)
 */
export async function getApprovedTemplates(channelId: string): Promise<FetchTemplatesResult> {
  try {
    const { hasAccess } = await verifyChannelAccess(channelId);
    if (!hasAccess) {
      return { success: false, error: 'No autorizado', templates: [] };
    }

    const templates = await db
      .select()
      .from(whatsappTemplates)
      .where(
        and(
          eq(whatsappTemplates.channelId, channelId),
          eq(whatsappTemplates.metaStatus, 'approved'),
        ),
      )
      .orderBy(desc(whatsappTemplates.createdAt));

    return { success: true, templates };
  } catch (error) {
    console.error('[getApprovedTemplates] Error:', error);
    return {
      success: false,
      error: 'No se pudieron cargar los templates aprobados',
      templates: [],
    };
  }
}

/**
 * Sync all template statuses for a channel from YCloud
 */
export async function syncAllTemplateStatuses(channelId: string): Promise<{
  success: boolean;
  synced: number;
  errors: string[];
}> {
  try {
    const { hasAccess } = await verifyChannelAccess(channelId);
    if (!hasAccess) {
      return { success: false, synced: 0, errors: ['No autorizado'] };
    }

    const templates = await db
      .select()
      .from(whatsappTemplates)
      .where(eq(whatsappTemplates.channelId, channelId));

    const apiKey = env.ycloudApiKey;
    if (!apiKey) {
      return { success: false, synced: 0, errors: ['Configuración de WhatsApp incompleta'] };
    }

    let synced = 0;
    const errors: string[] = [];

    for (const template of templates) {
      if (!template.metaTemplateId) {
        errors.push(`${template.name}: sin metaTemplateId`);
        continue;
      }

      try {
        const response = await fetch(
          `${YCLOUD_API_BASE}/whatsapp/templates/${template.metaTemplateId}`,
          {
            method: 'GET',
            headers: { 'X-API-Key': apiKey },
          },
        );

        if (!response.ok) {
          errors.push(`${template.name}: error ${response.status}`);
          continue;
        }

        const ycloudData = await response.json();
        // YCloud returns UPPERCASE statuses ('APPROVED') — persist lowercase.
        const metaStatus = normalizeMetaStatus(ycloudData.status);

        await db
          .update(whatsappTemplates)
          .set({ metaStatus, updatedAt: new Date() })
          .where(eq(whatsappTemplates.id, template.id));

        synced++;
      } catch (err) {
        errors.push(
          `${template.name}: ${err instanceof Error ? err.message : 'Error desconocido'}`,
        );
      }
    }

    return { success: true, synced, errors };
  } catch (error) {
    console.error('[syncAllTemplateStatuses] Error:', error);
    return { success: false, synced: 0, errors: ['Error general al sincronizar'] };
  }
}

/**
 * Send a template message using YCloud's sendDirectly API
 */
export async function sendTemplateMessage(data: {
  conversationId: string;
  channelId: string;
  templateName: string;
  components: {
    type: 'body' | 'header' | 'button';
    parameters: { type: 'text'; text: string }[];
  }[];
}): Promise<{ success: boolean; messageId?: string; error?: string; retryAfterSeconds?: number }> {
  try {
    const userId = await getAuthenticatedUserId();
    if (!userId) {
      return { success: false, error: 'No autorizado' };
    }

    // Verify channel and conversation
    const channel = await db
      .select({
        id: whatsappChannels.id,
        businessId: whatsappChannels.businessId,
        ycloudPhoneNumberId: whatsappChannels.ycloudPhoneNumberId,
      })
      .from(whatsappChannels)
      .where(eq(whatsappChannels.id, data.channelId))
      .limit(1);

    if (!channel.length) {
      return { success: false, error: 'Canal no encontrado' };
    }

    const hasAccess = await verifyChannelAccess(data.channelId);
    if (!hasAccess.hasAccess) {
      return { success: false, error: 'No autorizado' };
    }

    // Get conversation to find customer phone
    const { whatsappConversations } = await import('@/core/database/schema');
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

    // Anti-spam guards (Meta quality rating): only approved templates may be
    // sent outside the 24h window, and every outbound send is rate limited.
    const approved = await assertTemplateApproved(data.channelId, data.templateName);
    if (!approved) {
      return { success: false, error: 'Template no aprobado' };
    }

    const rateLimit = await assertOutboundRateLimit(data.channelId);
    if (!rateLimit.ok) {
      return {
        success: false,
        error: 'Límite de envíos alcanzado. Intentá más tarde.',
        retryAfterSeconds: rateLimit.retryAfterSeconds,
      };
    }

    const apiKey = env.ycloudApiKey;
    if (!apiKey) {
      return { success: false, error: 'Configuración de WhatsApp incompleta' };
    }

    // Prepare YCloud template message payload
    const ycloudPayload = {
      from: channel[0].ycloudPhoneNumberId,
      to: conv[0].customerPhone,
      type: 'template' as const,
      template: {
        name: data.templateName,
        components: data.components,
      },
    };

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
      console.error('[sendTemplateMessage] YCloud error:', ycloudResponse);
      return {
        success: false,
        error: ycloudResponse.message || 'Error al enviar template por WhatsApp',
      };
    }

    const ycloudMessageId = ycloudResponse.id;
    if (!ycloudMessageId) {
      return { success: false, error: 'Respuesta inválida de YCloud' };
    }

    // Store the message
    const { whatsappMessages } = await import('@/core/database/schema');
    const [newMessage] = await db
      .insert(whatsappMessages)
      .values({
        conversationId: data.conversationId,
        channelId: data.channelId,
        direction: 'outbound',
        type: 'template',
        templateName: data.templateName,
        body: JSON.stringify(data.components),
        ycloudMessageId,
        status: 'accepted',
      })
      .returning();

    // Update conversation timestamp
    await db
      .update(whatsappConversations)
      .set({ lastMessageAt: new Date(), updatedAt: new Date() })
      .where(eq(whatsappConversations.id, data.conversationId));

    return { success: true, messageId: newMessage.id };
  } catch (error) {
    console.error('[sendTemplateMessage] Error:', error);
    return { success: false, error: 'No se pudo enviar el template' };
  }
}
