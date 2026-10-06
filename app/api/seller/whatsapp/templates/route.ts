import { db } from '@/core/database/client';
import { businesses, whatsappChannels, whatsappTemplates } from '@/core/database/schema';
import { createClient } from '@/lib/supabase/server';
import { and, desc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { env } from '@/config/env';
import { BASE_TEMPLATES, applyBusinessName } from '@/features/chat/constants/baseTemplates';

const createTemplateSchema = z.object({
  channelId: z.string().uuid('ID de canal inválido'),
  name: z.string().min(1, 'Nombre requerido').max(512, 'Nombre demasiado largo'),
  category: z.enum(['marketing', 'utility', 'authentication']),
  language: z.string().min(2).max(10).default('es'),
  body: z.string().min(1, 'Cuerpo requerido'),
  components: z
    .array(
      z.object({
        type: z.enum(['header', 'body', 'button', 'footer']),
        format: z.enum(['TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT']).optional(),
        text: z.string().optional(),
        sub_type: z.enum(['url', 'quick_reply', 'phone_number']).optional(),
        url: z.string().url().optional(),
      }),
    )
    .optional(),
});

const createFromBaseSchema = z.object({
  channelId: z.string().uuid('ID de canal inválido'),
  baseTemplateName: z.enum(['order_confirmed', 'order_shipped', 'payment_reminder', 'delivery_update']),
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
      ycloudPhoneNumberId: whatsappChannels.ycloudPhoneNumberId,
    })
    .from(whatsappChannels)
    .where(eq(whatsappChannels.id, channelId))
    .limit(1);

  return channel[0] ?? null;
}

// GET /api/seller/whatsapp/templates - List templates for a channel
export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const channelId = searchParams.get('channelId');
    const onlyApproved = searchParams.get('approved') === 'true';

    if (!channelId) {
      return NextResponse.json({ error: 'channelId es requerido' }, { status: 400 });
    }

    const channel = await getChannelWithBusiness(channelId);
    if (!channel) {
      return NextResponse.json({ error: 'Canal no encontrado' }, { status: 404 });
    }

    const hasAccess = await verifyBusinessAccess(channel.businessId, user.id);
    if (!hasAccess) {
      return NextResponse.json({ error: 'Sin permisos para este canal' }, { status: 403 });
    }

    const whereClause = onlyApproved
      ? and(eq(whatsappTemplates.channelId, channelId), eq(whatsappTemplates.metaStatus, 'approved'))
      : eq(whatsappTemplates.channelId, channelId);

    const templates = await db
      .select()
      .from(whatsappTemplates)
      .where(whereClause)
      .orderBy(desc(whatsappTemplates.createdAt));

    return NextResponse.json({ templates });
  } catch (error) {
    console.error('[GET /api/seller/whatsapp/templates] Error:', error);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}

// POST /api/seller/whatsapp/templates - Create a template (or from base template)
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

    // Check if it's a base template creation
    const baseValidation = createFromBaseSchema.safeParse(rawBody);
    if (baseValidation.success) {
      return handleCreateFromBase(baseValidation.data, user.id);
    }

    // Regular template creation
    const validation = createTemplateSchema.safeParse(rawBody);
    if (!validation.success) {
      return NextResponse.json(
        { error: validation.error.issues[0]?.message || 'Datos inválidos' },
        { status: 400 },
      );
    }

    return handleCreateTemplate(validation.data, user.id);
  } catch (error) {
    console.error('[POST /api/seller/whatsapp/templates] Error:', error);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}

async function handleCreateFromBase(data: z.infer<typeof createFromBaseSchema>, userId: string) {
  const channel = await getChannelWithBusiness(data.channelId);
  if (!channel) {
    return NextResponse.json({ error: 'Canal no encontrado' }, { status: 404 });
  }

  const hasAccess = await verifyBusinessAccess(channel.businessId, userId);
  if (!hasAccess) {
    return NextResponse.json({ error: 'Sin permisos para este canal' }, { status: 403 });
  }

  // Get business name for template substitution
  const business = await db.query.businesses.findFirst({
    where: eq(businesses.id, channel.businessId),
    columns: { name: true },
  });

  if (!business) {
    return NextResponse.json({ error: 'Negocio no encontrado' }, { status: 404 });
  }

  const baseTemplate = BASE_TEMPLATES.find((t) => t.name === data.baseTemplateName);
  if (!baseTemplate) {
    return NextResponse.json({ error: 'Base template no encontrado' }, { status: 404 });
  }

  const templateWithBusiness = applyBusinessName(baseTemplate, business.name);

  const apiKey = env.ycloudApiKey;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Configuración de WhatsApp incompleta' },
      { status: 500 },
    );
  }

  // Prepare YCloud payload
  const ycloudPayload = {
    name: templateWithBusiness.name,
    category: templateWithBusiness.category,
    language: templateWithBusiness.language,
    components: templateWithBusiness.components?.map((comp) => {
      const base = { type: comp.type };
      if (comp.type === 'header') {
        return { ...base, format: comp.format || 'TEXT' };
      }
      if (comp.type === 'body') {
        return { ...base, text: comp.text || templateWithBusiness.body };
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
    console.error('[POST /api/seller/whatsapp/templates] YCloud error:', ycloudResponse);
    return NextResponse.json(
      { error: ycloudResponse.message || 'Error al crear template en YCloud' },
      { status: response.status },
    );
  }

  const metaTemplateId = ycloudResponse.id;
  if (!metaTemplateId) {
    return NextResponse.json({ error: 'Respuesta inválida de YCloud' }, { status: 500 });
  }

  // Store locally
  const [template] = await db
    .insert(whatsappTemplates)
    .values({
      channelId: data.channelId,
      name: templateWithBusiness.name,
      category: templateWithBusiness.category,
      language: templateWithBusiness.language,
      body: templateWithBusiness.body,
      metaStatus: 'pending',
      metaTemplateId,
    })
    .returning();

  return NextResponse.json({ template, ycloudTemplateId: metaTemplateId });
}

async function handleCreateTemplate(data: z.infer<typeof createTemplateSchema>, userId: string) {
  const channel = await getChannelWithBusiness(data.channelId);
  if (!channel) {
    return NextResponse.json({ error: 'Canal no encontrado' }, { status: 404 });
  }

  const hasAccess = await verifyBusinessAccess(channel.businessId, userId);
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

  // Prepare YCloud payload
  const ycloudPayload = {
    name: data.name,
    category: data.category,
    language: data.language,
    components: data.components?.map((comp) => {
      const base = { type: comp.type };
      if (comp.type === 'header') {
        return { ...base, format: comp.format || 'TEXT' };
      }
      if (comp.type === 'body') {
        return { ...base, text: comp.text || data.body };
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
    console.error('[POST /api/seller/whatsapp/templates] YCloud error:', ycloudResponse);
    return NextResponse.json(
      { error: ycloudResponse.message || 'Error al crear template en YCloud' },
      { status: response.status },
    );
  }

  const metaTemplateId = ycloudResponse.id;
  if (!metaTemplateId) {
    return NextResponse.json({ error: 'Respuesta inválida de YCloud' }, { status: 500 });
  }

  // Store locally
  const [template] = await db
    .insert(whatsappTemplates)
    .values({
      channelId: data.channelId,
      name: data.name,
      category: data.category,
      language: data.language,
      body: data.body,
      metaStatus: 'pending',
      metaTemplateId,
    })
    .returning();

  return NextResponse.json({ template, ycloudTemplateId: metaTemplateId });
}