// =====================================================
// upsertWhatsappChannel — cross-tenant ownership guard +
// TOCTOU race handling.
//
// Regression (W5): the SELECT-then-INSERT plan on the UNIQUE
// `ycloud_phone_number_id` races when two onboarding POSTs
// complete concurrently. The loser's INSERT throws a Postgres
// unique_violation (SQLSTATE 23505) that previously escaped
// as a 500. The upsert must treat the winner as the existing
// row: reactivate for the SAME business, friendly conflict
// for a FOREIGN business.
// =====================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const findFirst = vi.fn();
  const insert = vi.fn();
  const updateSet = vi.fn();
  return {
    findFirst,
    insert,
    updateSet,
    update: vi.fn(() => ({
      set: vi.fn((values: Record<string, unknown>) => {
        updateSet(values);
        return { where: vi.fn(() => Promise.resolve()) };
      }),
    })),
  };
});

vi.mock('@/core/database/client', () => ({
  db: {
    query: { whatsappChannels: { findFirst: mocks.findFirst } },
    insert: vi.fn(() => ({
      values: vi.fn((values: unknown) => mocks.insert(values)),
    })),
    update: mocks.update,
  },
}));

import { upsertWhatsappChannel } from '@/core/whatsapp/connect/whatsappChannelUpsert';

const BUSINESS_ID = '44444444-4444-4444-8444-444444444444';
const FOREIGN_BUSINESS_ID = '99999999-9999-4999-8999-999999999999';

const INPUT = {
  businessId: BUSINESS_ID,
  ycloudPhoneNumberId: '1045206517011070',
  wabaId: '102290129340398',
  displayPhoneNumber: null,
  connectionStatus: 'pending' as const,
  isActive: false,
  connectedAt: null,
};

describe('upsertWhatsappChannel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('inserts a channel when no row owns the number yet', async () => {
    mocks.findFirst.mockResolvedValueOnce(null);
    mocks.insert.mockResolvedValueOnce(undefined);

    const result = await upsertWhatsappChannel(INPUT);

    expect(result).toEqual({ outcome: 'inserted' });
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: BUSINESS_ID,
        ycloudPhoneNumberId: INPUT.ycloudPhoneNumberId,
        wabaId: INPUT.wabaId,
        isActive: false,
        connectionStatus: 'pending',
      }),
    );
    expect(mocks.updateSet).not.toHaveBeenCalled();
  });

  it('reactivates the same-business INACTIVE channel instead of inserting', async () => {
    mocks.findFirst.mockResolvedValueOnce({ id: 'ch-stale', businessId: BUSINESS_ID });

    const result = await upsertWhatsappChannel(INPUT);

    expect(result).toEqual({ outcome: 'reactivated' });
    expect(mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ isActive: false, connectionStatus: 'pending' }),
    );
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('returns conflict and leaves a FOREIGN business channel untouched', async () => {
    mocks.findFirst.mockResolvedValueOnce({ id: 'ch-foreign', businessId: FOREIGN_BUSINESS_ID });

    const result = await upsertWhatsappChannel(INPUT);

    expect(result).toEqual({
      outcome: 'conflict',
      reason: 'phone_number_belongs_to_another_business',
    });
    expect(mocks.updateSet).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('treats a concurrent unique-violation INSERT as the existing row (same business → reactivated)', async () => {
    // SELECT: nobody owns the number → INSERT races another POST → 23505
    mocks.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'ch-winner', businessId: BUSINESS_ID });
    mocks.insert.mockRejectedValueOnce({
      code: '23505',
      message:
        'duplicate key value violates unique constraint "whatsapp_channels_ycloud_phone_number_id_unique"',
    });

    const result = await upsertWhatsappChannel(INPUT);

    expect(result).toEqual({ outcome: 'reactivated' });
    expect(mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ isActive: false, connectionStatus: 'pending' }),
    );
  });

  it('turns a concurrent race with a FOREIGN winner into a friendly conflict', async () => {
    mocks.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'ch-foreign-winner', businessId: FOREIGN_BUSINESS_ID });
    mocks.insert.mockRejectedValueOnce({ code: '23505' });

    const result = await upsertWhatsappChannel(INPUT);

    expect(result).toEqual({
      outcome: 'conflict',
      reason: 'phone_number_belongs_to_another_business',
    });
    expect(mocks.updateSet).not.toHaveBeenCalled();
  });

  it('re-throws non-unique DB errors instead of masking them', async () => {
    mocks.findFirst.mockResolvedValueOnce(null);
    mocks.insert.mockRejectedValueOnce(new Error('connection pool exhausted'));

    await expect(upsertWhatsappChannel(INPUT)).rejects.toThrow('connection pool exhausted');
  });

  it('re-throws when the winner row vanishes between the failed INSERT and the re-read', async () => {
    mocks.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    mocks.insert.mockRejectedValueOnce({ code: '23505' });

    await expect(upsertWhatsappChannel(INPUT)).rejects.toMatchObject({ code: '23505' });
  });
});
