/**
 * Resolves the active WhatsApp channel id from a `fetchWhatsAppConversations`
 * result. The channel is reachable whenever it is CONNECTED, even when the
 * channel has ZERO conversations (fresh connect) — the server action exposes
 * `channelId` in that case. Kept as a pure function so every ChatClient path
 * (initial load, realtime subscribe, 10s poll) shares one tested behavior.
 */

export interface WhatsAppChannelResult {
  channelConnected?: boolean;
  channelId?: string | null;
}

export function resolveChannelId(result: WhatsAppChannelResult): string | null {
  return result.channelConnected ? (result.channelId ?? null) : null;
}