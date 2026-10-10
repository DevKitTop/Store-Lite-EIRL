// =====================================================
// normalizePhoneChannelStatus — pure status normalizer.
// Regression (W1): a failed YCloud status must DEACTIVATE
// the channel (isActive false) and clear the stale
// connectedAt, so polling/UI never see a connected-but-
// failed contradiction and the user can retry.
// =====================================================

import { describe, expect, it } from 'vitest';

import { normalizePhoneChannelStatus } from '@/core/whatsapp/connect/phoneChannelStatus';

describe('normalizePhoneChannelStatus', () => {
  it('maps CONNECTED to connected with activation timestamps', () => {
    const result = normalizePhoneChannelStatus('CONNECTED');
    expect(result).toEqual({
      connectionStatus: 'connected',
      isActive: true,
      connectedAt: expect.any(Date),
    });
  });

  it('maps DISCONNECTED to failed and DEACTIVATES the channel', () => {
    expect(normalizePhoneChannelStatus('DISCONNECTED')).toEqual({
      connectionStatus: 'failed',
      isActive: false,
      connectedAt: null,
    });
  });

  it('maps REJECTED and DEREGISTERED to failed and deactivated', () => {
    expect(normalizePhoneChannelStatus('REJECTED')).toEqual({
      connectionStatus: 'failed',
      isActive: false,
      connectedAt: null,
    });
    expect(normalizePhoneChannelStatus('DEREGISTERED')).toEqual({
      connectionStatus: 'failed',
      isActive: false,
      connectedAt: null,
    });
  });

  it('does not activate on lowercase connected — normalizes to pending', () => {
    expect(normalizePhoneChannelStatus('connected')).toEqual({ connectionStatus: 'pending' });
  });

  it('normalizes unknown and null statuses to pending', () => {
    expect(normalizePhoneChannelStatus('REGION_BLACKLISTED')).toEqual({
      connectionStatus: 'pending',
    });
    expect(normalizePhoneChannelStatus(undefined)).toEqual({ connectionStatus: 'pending' });
    expect(normalizePhoneChannelStatus(null)).toEqual({ connectionStatus: 'pending' });
  });
});
