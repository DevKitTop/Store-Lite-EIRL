// =====================================================
// normalizePhoneChannelStatus — YCloud phone number status
// normalizer (metaStatus.ts convention).
//
// YCloud reports phone-number statuses in UPPERCASE. The
// channel activates ONLY on exact 'CONNECTED': isActive=true
// + connectedAt=now. DISCONNECTED/REJECTED/DEREGISTERED map
// to 'failed'. Everything else (lowercase, unknown, empty)
// stays 'pending' and never activates the channel.
// =====================================================

import { describe, expect, it } from 'vitest';
import { normalizePhoneChannelStatus } from '../phoneChannelStatus';

describe('normalizePhoneChannelStatus', () => {
  it('activates on exact UPPERCASE CONNECTED', () => {
    const result = normalizePhoneChannelStatus('CONNECTED');
    expect(result).toEqual({
      connectionStatus: 'connected',
      isActive: true,
      connectedAt: expect.any(Date),
    });
  });

  it('maps DISCONNECTED/REJECTED/DEREGISTERED to failed without activating', () => {
    for (const status of ['DISCONNECTED', 'REJECTED', 'DEREGISTERED']) {
      // Coherent failed contract (W1-A): the channel is deactivated and the
      // previous connection timestamp cleared — not just a status string.
      expect(normalizePhoneChannelStatus(status)).toEqual({
        connectionStatus: 'failed',
        isActive: false,
        connectedAt: null,
      });
    }
  });

  it('does NOT activate on lowercase "connected"', () => {
    expect(normalizePhoneChannelStatus('connected')).toEqual({
      connectionStatus: 'pending',
    });
  });

  it('falls back to "pending" for unknown statuses', () => {
    expect(normalizePhoneChannelStatus('VERIFIED')).toEqual({
      connectionStatus: 'pending',
    });
  });

  it('falls back to "pending" for missing or empty status values', () => {
    expect(normalizePhoneChannelStatus('')).toEqual({ connectionStatus: 'pending' });
    expect(normalizePhoneChannelStatus(undefined)).toEqual({ connectionStatus: 'pending' });
    expect(normalizePhoneChannelStatus(null)).toEqual({ connectionStatus: 'pending' });
  });
});
