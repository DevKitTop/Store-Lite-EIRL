/**
 * Shared WhatsApp channel upsert with a cross-tenant ownership guard.
 *
 * `whatsapp_channels.ycloud_phone_number_id` is UNIQUE. Both onboarding
 * routes (init adopt + complete bind) may encounter a stale INACTIVE row
 * that already owns the number. Reactivating it is only safe when the row
 * belongs to the SAME authenticated business — otherwise the upsert refuses
 * and returns `conflict`, leaving the foreign tenant's channel untouched.
 *
 * The caller decides the target state (isActive, connectionStatus):
 *   - init (adopt an already-CONNECTED number) → connected / isActive true
 *   - complete (bind a fresh onboarding number) → pending / isActive false
 * The webhook/poll flips the channel to connected afterwards.
 */

import { db } from '@/core/database/client';
import { whatsappChannels } from '@/core/database/schema';
import { eq } from 'drizzle-orm';

import type { PhoneChannelStatus } from './phoneChannelStatus';

export type ChannelUpsertOutcome =
  | { outcome: 'inserted' }
  | { outcome: 'reactivated' }
  | { outcome: 'conflict'; reason: 'phone_number_belongs_to_another_business' };

export interface ChannelUpsertInput {
  businessId: string;
  ycloudPhoneNumberId: string;
  wabaId: string;
  displayPhoneNumber: string | null;
  connectionStatus: PhoneChannelStatus;
  isActive: boolean;
  connectedAt: Date | null;
}

export async function upsertWhatsappChannel(
  input: ChannelUpsertInput,
): Promise<ChannelUpsertOutcome> {
  const owner = await db.query.whatsappChannels.findFirst({
    where: eq(whatsappChannels.ycloudPhoneNumberId, input.ycloudPhoneNumberId),
    columns: { id: true, businessId: true },
  });

  if (owner) {
    return reactivateOrConflict(owner.id, owner.businessId, input);
  }

  try {
    await db.insert(whatsappChannels).values({
      businessId: input.businessId,
      ycloudPhoneNumberId: input.ycloudPhoneNumberId,
      wabaId: input.wabaId,
      isActive: input.isActive,
      displayPhoneNumber: input.displayPhoneNumber,
      connectionStatus: input.connectionStatus,
      connectedAt: input.connectedAt,
    });

    return { outcome: 'inserted' };
  } catch (error) {
    // TOCTOU race: a concurrent POST committed the same UNIQUE
    // ycloud_phone_number_id between our SELECT and INSERT. Resolve the
    // winner as the existing row instead of leaking a 500 (W5).
    if (!isUniqueViolation(error)) throw error;

    const current = await db.query.whatsappChannels.findFirst({
      where: eq(whatsappChannels.ycloudPhoneNumberId, input.ycloudPhoneNumberId),
      columns: { id: true, businessId: true },
    });
    if (!current) throw error;

    return reactivateOrConflict(current.id, current.businessId, input);
  }
}

/**
 * Reactivates a same-business channel with the caller's target state, or
 * refuses when the number belongs to another businessId (even stale/INACTIVE).
 */
async function reactivateOrConflict(
  channelId: string,
  channelBusinessId: string,
  input: ChannelUpsertInput,
): Promise<ChannelUpsertOutcome> {
  if (channelBusinessId !== input.businessId) {
    return { outcome: 'conflict', reason: 'phone_number_belongs_to_another_business' };
  }

  await db
    .update(whatsappChannels)
    .set({
      wabaId: input.wabaId,
      isActive: input.isActive,
      displayPhoneNumber: input.displayPhoneNumber,
      connectionStatus: input.connectionStatus,
      connectedAt: input.connectedAt,
      updatedAt: new Date(),
    })
    .where(eq(whatsappChannels.id, channelId));

  return { outcome: 'reactivated' };
}

/**
 * Postgres raises SQLSTATE 23505 (unique_violation) on the UNIQUE
 * ycloud_phone_number_id constraint. Drizzle surfaces the PgError with a
 * `.code` field; tolerate drivers that only expose it via the message.
 */
function isUniqueViolation(error: unknown): boolean {
  if (error && typeof error === 'object' && 'code' in error) {
    return (error as { code?: unknown }).code === '23505';
  }
  return false;
}
