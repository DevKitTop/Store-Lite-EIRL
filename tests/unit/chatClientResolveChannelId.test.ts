// =====================================================
// resolveChannelId — ChatClient helper tests
// Blocker-1 fix: the active WhatsApp channel id must be
// resolved from the fetch result whenever the channel is
// CONNECTED, regardless of the conversation count.
// =====================================================

import { describe, expect, it } from 'vitest';
import { resolveChannelId } from '../../app/[slug]/(app)/chat/components/chatChannel';

describe('resolveChannelId', () => {
  it('returns the channel id for a connected channel with ZERO conversations', () => {
    expect(resolveChannelId({ channelConnected: true, channelId: 'chan-1' })).toBe('chan-1');
  });

  it('returns the channel id for a connected channel that also has conversations', () => {
    expect(
      resolveChannelId({
        channelConnected: true,
        channelId: 'chan-1',
        conversations: [{ channelId: 'chan-1' }],
      }),
    ).toBe('chan-1');
  });

  it('returns null when the channel is not connected even if an id is present', () => {
    expect(resolveChannelId({ channelConnected: false, channelId: 'chan-1' })).toBeNull();
  });

  it('returns null when connected but the id is missing', () => {
    expect(resolveChannelId({ channelConnected: true, channelId: null })).toBeNull();
  });

  it('returns null when the result has no channel information at all', () => {
    expect(resolveChannelId({})).toBeNull();
  });
});