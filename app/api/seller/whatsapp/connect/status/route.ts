import { env } from '@/config/env';
import { db } from '@/core/database/client';
import { businesses, whatsappChannels } from '@/core/database/schema';
import { normalizePhoneChannelStatus } from '@/core/whatsapp/connect/phoneChannelStatus';
import { createClient } from '@/lib/supabase/server';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const connectStatusSchema = z.object({
  phoneNumberId: z.string().min(1, 'phoneNumberId es requerido'),
  // Optional: adoption polling sends it; must match the channel's business.
  businessId: z.string().uuid('ID de negocio inválido').optional(),
});

const YCLOUD_API_BASE = 'https://api.ycloud.com/v2';

export async function POST(request: Request) {
  try {
    const rawBody = await request.json();

    // Validate input
    const validationResult = connectStatusSchema.safeParse(rawBody);
    if (!validationResult.success) {
      return NextResponse.json(
        {
          error: validationResult.error.issues[0]?.message || 'Datos inválidos',
        },
        { status: 400 },
      );
    }

    const { phoneNumberId, businessId } = validationResult.data;

    // Authenticate user
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }

    // Find the channel by phoneNumberId
    const channel = await db.query.whatsappChannels.findFirst({
      where: eq(whatsappChannels.ycloudPhoneNumberId, phoneNumberId),
      columns: {
        id: true,
        businessId: true,
        ycloudPhoneNumberId: true,
        isActive: true,
        connectionStatus: true,
        connectedAt: true,
        displayPhoneNumber: true,
      },
    });

    if (!channel) {
      return NextResponse.json({ error: 'Canal no encontrado' }, { status: 404 });
    }

    // When the caller supplies a businessId, it MUST match the channel's
    // business — cross-tenant status reads fail closed.
    if (businessId && businessId !== channel.businessId) {
      return NextResponse.json({ error: 'Sin permisos para este canal' }, { status: 403 });
    }

    // Verify ownership - fetch business separately
    const business = await db.query.businesses.findFirst({
      where: eq(businesses.id, channel.businessId),
      columns: { ownerId: true },
    });

    if (!business || business.ownerId !== user.id) {
      return NextResponse.json({ error: 'Sin permisos para este canal' }, { status: 403 });
    }

    // If already active, return current state. BUT an 'active + failed'
    // contradiction must never report connected: let the YCloud check below
    // resolve the truth (W1 — the webhook may have missed the failure).
    if (channel.isActive && channel.connectionStatus !== 'failed') {
      return NextResponse.json({
        status: 'connected',
        isActive: true,
        connectionStatus: channel.connectionStatus,
        displayPhoneNumber: channel.displayPhoneNumber,
        connectedAt: channel.connectedAt,
      });
    }

    // Get YCloud credentials
    const apiKey = env.ycloudApiKey;

    if (!apiKey) {
      console.error('[whatsapp/connect/status] Missing YCloud API key');
      return NextResponse.json({ error: 'Configuración de WhatsApp incompleta' }, { status: 500 });
    }

    // Query YCloud for current status. The per-number GET endpoint does not
    // exist in the current API, so list the account numbers and match by id.
    let ycloudData: unknown;
    try {
      const ycloudResponse = await fetch(`${YCLOUD_API_BASE}/whatsapp/phoneNumbers`, {
        method: 'GET',
        headers: {
          'X-API-Key': apiKey,
          'Content-Type': 'application/json',
        },
      });
      ycloudData = await ycloudResponse.json();

      if (!ycloudResponse.ok) {
        console.error('[whatsapp/connect/status] YCloud error:', ycloudData);
        // Don't fail - return current DB state, coherently: a failed
        // channel never degrades back to 'pending' (W1).
        const dbFailed = channel.connectionStatus === 'failed';
        return NextResponse.json({
          status: dbFailed ? 'failed' : 'pending',
          isActive: dbFailed ? false : channel.isActive,
          connectionStatus: channel.connectionStatus,
          displayPhoneNumber: channel.displayPhoneNumber,
          connectedAt: dbFailed ? null : channel.connectedAt,
        });
      }
    } catch (error) {
      console.error('[whatsapp/connect/status] YCloud request failed:', error);
      // Don't fail - return current DB state, coherently (W1).
      const dbFailed = channel.connectionStatus === 'failed';
      return NextResponse.json({
        status: dbFailed ? 'failed' : 'pending',
        isActive: dbFailed ? false : channel.isActive,
        connectionStatus: channel.connectionStatus,
        displayPhoneNumber: channel.displayPhoneNumber,
        connectedAt: dbFailed ? null : channel.connectedAt,
      });
    }

    // List endpoints return a paginated page ({ items: [...] }); tolerate a
    // raw array defensively.
    interface YCloudPhoneNumber {
      id?: string;
      status?: string;
      displayPhoneNumber?: string | null;
    }
    const body = ycloudData as YCloudPhoneNumber[] | { items?: YCloudPhoneNumber[] } | null;
    const phoneNumbers = Array.isArray(body) ? body : (body?.items ?? []);
    const ycloudNumber = phoneNumbers.find((number) => number.id === channel.ycloudPhoneNumberId);

    const ycloudStatus = ycloudNumber?.status;
    const displayPhoneNumber = ycloudNumber?.displayPhoneNumber ?? channel.displayPhoneNumber;

    // If connected, update database
    if (ycloudStatus === 'CONNECTED') {
      const connectedAt = new Date();
      await db
        .update(whatsappChannels)
        .set({
          isActive: true,
          connectionStatus: 'connected',
          connectedAt,
          displayPhoneNumber: displayPhoneNumber ?? null,
          updatedAt: new Date(),
        })
        .where(eq(whatsappChannels.id, channel.id));

      return NextResponse.json({
        status: 'connected',
        isActive: true,
        connectionStatus: 'connected',
        displayPhoneNumber,
        connectedAt,
      });
    }

    // Coherent failed state (W1): YCloud reports the number is not
    // operational. Deactivate and clear the connection timestamp — mirroring
    // the webhook — so polling sees 'failed' and drives retry.
    const normalized = normalizePhoneChannelStatus(ycloudStatus);
    if (normalized.connectionStatus === 'failed') {
      await db
        .update(whatsappChannels)
        .set({
          isActive: false,
          connectionStatus: 'failed',
          connectedAt: null,
          displayPhoneNumber: displayPhoneNumber ?? null,
          updatedAt: new Date(),
        })
        .where(eq(whatsappChannels.id, channel.id));

      return NextResponse.json({
        status: 'failed',
        isActive: false,
        connectionStatus: 'failed',
        displayPhoneNumber,
        connectedAt: null,
      });
    }

    // Return pending status
    return NextResponse.json({
      status: ycloudStatus || 'pending',
      isActive: false,
      connectionStatus: channel.connectionStatus,
      displayPhoneNumber: channel.displayPhoneNumber,
      connectedAt: channel.connectedAt,
    });
  } catch (error) {
    console.error('[whatsapp/connect/status] Error:', error);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
