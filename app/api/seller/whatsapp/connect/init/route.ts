import { env } from '@/config/env';
import { db } from '@/core/database/client';
import { businesses, whatsappChannels } from '@/core/database/schema';
import { upsertWhatsappChannel } from '@/core/whatsapp/connect/whatsappChannelUpsert';
import { createClient } from '@/lib/supabase/server';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const connectInitSchema = z.object({
  businessId: z.string().uuid('ID de negocio inválido'),
});

const YCLOUD_API_BASE = 'https://api.ycloud.com/v2';

export async function POST(request: Request) {
  try {
    const rawBody = await request.json();

    // Validate input
    const validationResult = connectInitSchema.safeParse(rawBody);
    if (!validationResult.success) {
      return NextResponse.json(
        {
          error: validationResult.error.issues[0]?.message || 'Datos inválidos',
        },
        { status: 400 },
      );
    }

    const { businessId } = validationResult.data;

    // Authenticate user
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }

    // Verify business ownership
    const business = await db.query.businesses.findFirst({
      where: and(eq(businesses.id, businessId), eq(businesses.ownerId, user.id)),
      columns: { id: true },
    });

    if (!business) {
      return NextResponse.json({ error: 'Negocio no encontrado o sin permisos' }, { status: 403 });
    }

    // Check if business already has a WhatsApp channel
    const existingChannel = await db.query.whatsappChannels.findFirst({
      where: eq(whatsappChannels.businessId, businessId),
      columns: { id: true, isActive: true, ycloudPhoneNumberId: true },
    });

    if (existingChannel?.isActive) {
      return NextResponse.json(
        { error: 'Este negocio ya tiene un canal WhatsApp activo' },
        { status: 409 },
      );
    }

    // Get YCloud credentials
    const apiKey = env.ycloudApiKey;
    const wabaId = env.ycloudWabaId;

    if (!apiKey || !wabaId) {
      console.error('[whatsapp/connect/init] Missing YCloud credentials');
      return NextResponse.json(
        { error: 'Configuración de WhatsApp incompleta. Contacta al administrador.' },
        { status: 500 },
      );
    }

    // The current YCloud API has no register endpoint that accepts a WABA id.
    // The account already owns its phone numbers, so list them and adopt the
    // CONNECTED one that belongs to the configured WABA.
    const ycloudResponse = await fetch(`${YCLOUD_API_BASE}/whatsapp/phoneNumbers`, {
      method: 'GET',
      headers: {
        'X-API-Key': apiKey,
        'Content-Type': 'application/json',
      },
    });

    const ycloudData = await ycloudResponse.json();

    if (!ycloudResponse.ok) {
      console.error('[whatsapp/connect/init] YCloud error:', ycloudData);
      return NextResponse.json(
        { error: ycloudData.message || 'Error al iniciar conexión con WhatsApp' },
        { status: ycloudResponse.status },
      );
    }

    // List endpoints return a paginated page ({ items: [...] }); tolerate a
    // raw array defensively.
    interface YCloudPhoneNumber {
      id: string;
      status?: string;
      wabaId?: string;
      displayPhoneNumber?: string | null;
    }
    const phoneNumbers: YCloudPhoneNumber[] = Array.isArray(ycloudData)
      ? ycloudData
      : (ycloudData?.items ?? []);
    const connectedNumber = phoneNumbers.find(
      (number) => number.status === 'CONNECTED' && number.wabaId === wabaId,
    );

    if (!connectedNumber) {
      return NextResponse.json(
        {
          error:
            'No hay un número de WhatsApp conectado en la cuenta de YCloud. Conecta un número desde la consola de YCloud primero.',
        },
        { status: 409 },
      );
    }

    const { id: phoneNumberId, displayPhoneNumber } = connectedNumber;

    const connectedAt = new Date();

    // Shared tenant-scoped upsert: guards ycloudPhoneNumberId uniqueness and
    // only reactivates a stale channel owned by the authenticated business.
    const upsertResult = await upsertWhatsappChannel({
      businessId,
      ycloudPhoneNumberId: phoneNumberId,
      wabaId,
      displayPhoneNumber: displayPhoneNumber ?? null,
      connectionStatus: 'connected',
      isActive: true,
      connectedAt,
    });

    if (upsertResult.outcome === 'conflict') {
      return NextResponse.json(
        { error: 'Este número de WhatsApp ya está vinculado a otro negocio' },
        { status: 409 },
      );
    }

    // Return the adopted number: the account is already connected, so the
    // client knows no pairing modal is needed.
    return NextResponse.json({
      phoneNumberId,
      status: 'connected',
      displayPhoneNumber: displayPhoneNumber ?? null,
      connectedAt,
    });
  } catch (error) {
    console.error('[whatsapp/connect/init] Error:', error);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
