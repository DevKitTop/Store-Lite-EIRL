// =====================================================
// ChatClient — WhatsApp UI is hidden from sellers (MVP)
// =====================================================
// The WhatsApp integration is intentionally hidden from the seller UI until a
// YCloud channel / WABA is configured. The WhatsApp filter tab was the only
// entry point to the connect modal and the template manager, so it is no longer
// rendered. The underlying wiring is kept dormant for a future retake; this
// test guards against the tab (and its connect CTA) silently reappearing.

import { ChatClient } from '@/app/[slug]/(app)/chat/components/ChatClient';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const BUSINESS_ID = '22222222-2222-4222-8222-222222222222';

// ── Mocks (vi.hoisted ensures availability inside vi.mock factories) ──

const {
  mockDeleteChatSession,
  mockFetchChatSessions,
  mockFetchMessages,
  mockSendMessage,
  mockFetchWhatsAppConversations,
  mockFetchWhatsAppMessages,
  mockSendWhatsAppMessage,
} = vi.hoisted(() => ({
  mockDeleteChatSession: vi.fn(),
  mockFetchChatSessions: vi.fn(),
  mockFetchMessages: vi.fn(),
  mockSendMessage: vi.fn(),
  mockFetchWhatsAppConversations: vi.fn(),
  mockFetchWhatsAppMessages: vi.fn(),
  mockSendWhatsAppMessage: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => {
  const channel = {
    on: () => channel,
    subscribe: (callback?: (status: string, error?: Error) => void) => {
      callback?.('SUBSCRIBED');
      return channel;
    },
  };
  return {
    createClient: () => ({
      channel: () => channel,
      removeChannel: vi.fn(),
    }),
  };
});

vi.mock('@/app/[slug]/(app)/chat/actions/chatActions', () => ({
  deleteChatSession: mockDeleteChatSession,
  fetchChatSessions: mockFetchChatSessions,
  fetchMessages: mockFetchMessages,
  sendMessage: mockSendMessage,
}));

vi.mock('@/app/[slug]/(app)/chat/actions/whatsappActions', () => ({
  fetchWhatsAppConversations: mockFetchWhatsAppConversations,
  fetchWhatsAppMessages: mockFetchWhatsAppMessages,
  sendWhatsAppMessage: mockSendWhatsAppMessage,
}));

// ── Helpers ─────────────────────────────────────────────

function renderChatClient() {
  return render(
    <ChatClient
      slug="test-store"
      storeName="Test Store"
      storeDescription="Test description"
      storeLogo=""
      businessId={BUSINESS_ID}
      canRespond
      canManage
    />,
  );
}

// ── Tests ───────────────────────────────────────────────

describe('ChatClient — WhatsApp UI is hidden', () => {
  beforeEach(() => {
    mockFetchChatSessions.mockResolvedValue({ success: true, sessions: [] });
    mockFetchWhatsAppConversations.mockResolvedValue({
      success: true,
      conversations: [],
      channelConnected: false,
      channelId: null,
    });
    mockFetchWhatsAppMessages.mockResolvedValue({ success: true, messages: [] });
    mockSendWhatsAppMessage.mockResolvedValue({ success: false, error: 'not used' });
    mockDeleteChatSession.mockResolvedValue({ success: true });
    mockFetchMessages.mockResolvedValue({ success: true, messages: [] });
    mockSendMessage.mockResolvedValue({ success: true, message: null });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('does not render the WhatsApp filter tab', () => {
    renderChatClient();

    expect(screen.queryByRole('button', { name: 'WhatsApp' })).not.toBeInTheDocument();
  });

  it('does not expose the WhatsApp connect CTA', () => {
    renderChatClient();

    expect(screen.queryByText('Conectar WhatsApp')).not.toBeInTheDocument();
  });

  it('keeps the remaining chat filter tabs', () => {
    renderChatClient();

    expect(screen.getByRole('button', { name: 'Todo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ventas' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sin leer' })).toBeInTheDocument();
  });
});
