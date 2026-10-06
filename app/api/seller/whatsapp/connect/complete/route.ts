import { env } from '@/config/env';
import { db } from '@/core/database/client';
import { businesses, whatsappChannels } from '@/core/database/schema';
import { upsertWhatsappChannel } from '@/core/whatsapp/connect/whatsappChannelUpsert';
import { createClient } from '@/lib/supabase/server';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const connectCompleteSchema = z.object({
  businessId: z.string().uuid('ID de negocio inválido'),
  // YCloud/Meta WABA and phone-number IDs are digit-only numeric strings;
  // the values flow into URL paths and the bind body, so reject anything
  // that can never be a real ID before touching auth or YCloud.
  wabaId: z.string().regex(/^\d+$/, 'wabaId inválido'),
  phoneNumberId: z.string().regex(/^\d+$/, 'phoneNumberId inválido'),
});

const YCLOUD_API_BASE = 'https://api.ycloud.com/v2';

const FOREIGN_CHANNEL_ERROR = 'Este número de WhatsApp ya está vinculado a otro negocio';

export async function POST(request: Request) {
  try {
    const rawBody = await request.json();

    // Validate input
    const validationResult = connectCompleteSchema.safeParse(rawBody);
    if (!validationResult.success) {
      return NextResponse.json(
        {
          error: validationResult.error.issues[0]?.message || 'Datos inválidos',
        },
        { status: 400 },
      );
    }

    const { businessId, wabaId, phoneNumberId } = validationResult.data;

    // Authenticate user
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }

    // The scoping businessId comes from the SESSION, never the payload:
    // a seller completing a popup for business A must never claim business B.
    const business = await db.query.businesses.findFirst({
      where: and(eq(businesses.id, businessId), eq(businesses.ownerId, user.id)),
      columns: { id: true },
    });

    if (!business) {
      return NextResponse.json({ error: 'Negocio no encontrado o sin permisos' }, { status: 403 });
    }

    // Check if the business already has an active WhatsApp channel
    const existingChannel = await db.query.whatsappChannels.findFirst({
      where: eq(whatsappChannels.businessId, businessId),
      columns: { id: true, isActive: true },
    });

    if (existingChannel?.isActive) {
      return NextResponse.json(
        { error: 'Este negocio ya tiene un canal WhatsApp activo' },
        { status: 409 },
      );
    }

    // Get YCloud credentials
    const apiKey = env.ycloudApiKey;

    if (!apiKey) {
      console.error('[whatsapp/connect/complete] Missing YCloud API key');
      return NextResponse.json(
        { error: 'Configuración de WhatsApp incompleta. Contacta al administrador.' },
        { status: 500 },
      );
    }

    // Bind the seller's own WABA number FIRST. No DB write happens until
    // YCloud confirms the bind — a failed bind must leave the channel row
    // untouched so the modal can retry.
    const ycloudResponse = await fetch(
      `${YCLOUD_API_BASE}/whatsapp/businessAccounts/${wabaId}/smb/bind`,
      {
        method: 'POST',
        headers: {
          'X-API-Key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ phoneNumberId }),
      },
    );

    const ycloudData = (await ycloudResponse.json()) as { message?: string } | null;

    if (!ycloudResponse.ok) {
      console.error('[whatsapp/connect/complete] YCloud bind error:', ycloudData);
      // Surface YCloud's own message (e.g. PAYMENT_METHOD_REQUIRED,
      // WABA_NOT_FOUND) so the modal can show it with retry.
      return NextResponse.json(
        { error: ycloudData?.message || 'Error al vincular el número de WhatsApp' },
        { status: ycloudResponse.status },
      );
    }

    // Tenant-scoped upsert: guards ycloudPhoneNumberId uniqueness and only
    // reactivates a stale channel owned by the authenticated business.
    const upsertResult = await upsertWhatsappChannel({
      businessId,
      ycloudPhoneNumberId: phoneNumberId,
      wabaId,
      displayPhoneNumber: null,
      connectionStatus: 'pending',
      isActive: false,
      connectedAt: null,
    });

    if (upsertResult.outcome === 'conflict') {
      return NextResponse.json({ error: FOREIGN_CHANNEL_ERROR }, { status: 409 });
    }

    // Mirrors the /connect/status contract the modal already polls.
    // displayPhoneNumber is unknown until YCloud reports the number
    // (poll/webhook fills it in).
    return NextResponse.json({
      phoneNumberId,
      wabaId,
      status: 'pending',
      connectionStatus: 'pending',
      displayPhoneNumber: null,
    });
  } catch (error) {
    console.error('[whatsapp/connect/complete] Error:', error);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
