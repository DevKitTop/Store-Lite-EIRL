import { db } from '@/core/database/client';
import { businesses, whatsappChannels, whatsappTemplates } from '@/core/database/schema';
import { normalizeMetaStatus } from '@/core/whatsapp/templates/metaStatus';
import { createClient } from '@/lib/supabase/server';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { env } from '@/config/env';

interface SyncResultEntry {
  name: string;
  metaStatus: string;
  metaTemplateId: string | null;
}

const syncSchema = z.object({
  channelId: z.string().uuid('ID de canal inválido'),
});

const YCLOUD_API_BASE = 'https://api.ycloud.com/v2';

async function verifyBusinessAccess(businessId: string, userId: string): Promise<boolean> {
  const business = await db.query.businesses.findFirst({
    where: eq(businesses.id, businessId),
    columns: { ownerId: true },
  });

  if (!business) return false;
  if (business.ownerId === userId) return true;

  // Check team member - simplified for now
  return false;
}

async function getChannelWithBusiness(channelId: string) {
  const channel = await db
    .select({
      id: whatsappChannels.id,
      businessId: whatsappChannels.businessId,
    })
    .from(whatsappChannels)
    .where(eq(whatsappChannels.id, channelId))
    .limit(1);

  return channel[0] ?? null;
}

// POST /api/seller/whatsapp/templates/sync - Sync all template statuses from YCloud
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }

    const rawBody = await request.json();
    const validation = syncSchema.safeParse(rawBody);

    if (!validation.success) {
      return NextResponse.json(
        { error: validation.error.issues[0]?.message || 'Datos inválidos' },
        { status: 400 },
      );
    }

    const { channelId } = validation.data;

    const channel = await getChannelWithBusiness(channelId);
    if (!channel) {
      return NextResponse.json({ error: 'Canal no encontrado' }, { status: 404 });
    }

    const hasAccess = await verifyBusinessAccess(channel.businessId, user.id);
    if (!hasAccess) {
      return NextResponse.json({ error: 'Sin permisos para este canal' }, { status: 403 });
    }

    const apiKey = env.ycloudApiKey;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'Configuración de WhatsApp incompleta' },
        { status: 500 },
      );
    }

    // Get all templates for this channel that have metaTemplateId
    const templates = await db
      .select()
      .from(whatsappTemplates)
      .where(and(eq(whatsappTemplates.channelId, channelId)));

    let synced = 0;
    const errors: string[] = [];
    const results: SyncResultEntry[] = [];

    for (const template of templates) {
      if (!template.metaTemplateId) {
        errors.push(`${template.name}: sin metaTemplateId`);
        results.push({
          name: template.name,
          metaStatus: template.metaStatus as string,
          metaTemplateId: null as string | null,
        });
        continue;
      }

      const metaTemplateId: string = template.metaTemplateId;

      try {
        const response = await fetch(`${YCLOUD_API_BASE}/whatsapp/templates/${metaTemplateId}`, {
          method: 'GET',
          headers: { 'X-API-Key': apiKey },
        });

        if (!response.ok) {
          errors.push(`${template.name}: error ${response.status}`);
          results.push({
            name: template.name,
            metaStatus: template.metaStatus as string,
            metaTemplateId,
          });
          continue;
        }

        const ycloudData = await response.json();
        // YCloud returns UPPERCASE statuses ('APPROVED') — persist lowercase.
        const metaStatus = normalizeMetaStatus(ycloudData.status);

        // Update local status if changed
        if (metaStatus !== template.metaStatus) {
          await db
            .update(whatsappTemplates)
            .set({ metaStatus, updatedAt: new Date() })
            .where(eq(whatsappTemplates.id, template.id));
        }

        synced++;
        results.push({
          name: template.name,
          metaStatus,
          metaTemplateId,
        });
      } catch (err) {
        errors.push(`${template.name}: ${err instanceof Error ? err.message : 'Error desconocido'}`);
        results.push({
          name: template.name,
          metaStatus: template.metaStatus as string,
          metaTemplateId,
        });
      }
    }

    return NextResponse.json({
      synced,
      total: templates.length,
      errors,
      results,
    });
  } catch (error) {
    console.error('[POST /api/seller/whatsapp/templates/sync] Error:', error);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}