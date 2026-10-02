// =====================================================
// OrderChatSection — realtime session scoping (R6 / C10)
// Spec: the order-chat channel MUST subscribe with
// `filter: 'session_id=eq.${sessionId}'` (ChatDialog pattern), so rows from
// other sessions never reach the client; the client-side discard stays as
// defense-in-depth.
// =====================================================

import OrderChatSection from '@/app/[slug]/(app)/order/[token]/OrderChatSection';
import { act, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Constants ────────────────────────────────────────

const SESSION_ID = 'a1b2c3d4-0000-4000-8000-000000000001';
const FOREIGN_SESSION_ID = 'ffffffff-0000-4000-8000-0000000000ff';
const PAYMENT_ID = 'payment-own';
const FOREIGN_PAYMENT_ID = 'payment-foreign';

// ── Mocks ────────────────────────────────────────────

const mockSyncChatSession = vi.fn();
vi.mock('@/app/[slug]/(app)/order/[token]/actions', () => ({
  syncChatSession: (...args: unknown[]) => mockSyncChatSession(...args),
}));

const mockFetchMessages = vi.fn();
const mockSendMessage = vi.fn();
vi.mock('@/features/chat/actions/chatActions', () => ({
  fetchMessages: (...args: unknown[]) => mockFetchMessages(...args),
  sendMessage: (...args: unknown[]) => mockSendMessage(...args),
}));

vi.mock('@/shared/components/ui', () => ({
  Icon: ({ children, size = 24 }: { children?: ReactNode; size?: number }) => (
    <md-icon size={size}>{children}</md-icon>
  ),
}));

// ── Supabase realtime double ─────────────────────────

type InsertHandler = (payload: { new: Record<string, unknown> }) => void;

const channelSpy = vi.fn();
const onSpy = vi.fn();
const subscribeSpy = vi.fn();
const removeChannelSpy = vi.fn();

const channelApi = { on: onSpy, subscribe: subscribeSpy };

const supabaseMock = { channel: channelSpy, removeChannel: removeChannelSpy };

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => supabaseMock,
}));

// Config + callback captured from the production `channel().on(...)` call.
let lastConfig: Record<string, string> | undefined;
let lastHandler: InsertHandler | undefined;

const baseProps = {
  businessName: 'Mi Tienda',
  businessId: 'business-1',
  paymentId: PAYMENT_ID,
  buyerEmail: 'ana@example.com',
  buyerName: 'Ana',
  buyerDni: '12345678',
  trackingToken: 'tracking-token-1',
};

function messageRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg-1',
    session_id: SESSION_ID,
    payment_id: PAYMENT_ID,
    content: 'Hola, hay stock?',
    is_from_store: false,
    created_at: '2026-01-01T12:00:00.000Z',
    ...overrides,
  };
}

/**
 * Test double for the Supabase realtime server: it honours the `filter`
 * declared in the channel config, so a row only reaches the client callback
 * when it satisfies `session_id=eq.<id>`. Returns whether the row was
 * delivered to the client.
 */
function deliverViaServer(row: Record<string, unknown>): boolean {
  const filter = lastConfig?.filter;
  if (filter) {
    const expectedSessionId = filter.replace('session_id=eq.', '');
    if (String(row.session_id) !== expectedSessionId) return false;
  }
  act(() => {
    lastHandler?.({ new: row });
  });
  return true;
}

beforeAll(() => {
  // jsdom does not implement scrollIntoView (OrderChatSection:239)
  Element.prototype.scrollIntoView = vi.fn();
});

beforeEach(() => {
  lastConfig = undefined;
  lastHandler = undefined;
  localStorage.clear();

  // vitest.config.ts sets restoreMocks/clearMocks → (re)declare impls per test
  onSpy.mockImplementation(
    (_type: string, config: Record<string, string>, handler: InsertHandler) => {
      lastConfig = config;
      lastHandler = handler;
      return channelApi;
    },
  );
  subscribeSpy.mockImplementation(() => channelApi);
  channelSpy.mockImplementation(() => channelApi);

  mockSyncChatSession.mockResolvedValue({
    success: true,
    sessionId: SESSION_ID,
    guestId: 'guest-1',
  });
  mockFetchMessages.mockResolvedValue({ success: true, messages: [] });
  mockSendMessage.mockResolvedValue({ success: false, error: 'not used' });
});

describe('OrderChatSection — realtime subscription scoping', () => {
  it('subscribes to messages INSERT with a server-side session_id filter', async () => {
    render(<OrderChatSection {...baseProps} />);

    await waitFor(() => expect(onSpy).toHaveBeenCalledTimes(1));

    expect(channelSpy).toHaveBeenCalledWith(`order-chat-${SESSION_ID}`);
    expect(onSpy).toHaveBeenCalledWith(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `session_id=eq.${SESSION_ID}`,
      },
      expect.any(Function),
    );
    expect(subscribeSpy).toHaveBeenCalledTimes(1);
  });

  it('never delivers a row from another session to the client', async () => {
    render(<OrderChatSection {...baseProps} />);
    await waitFor(() => expect(onSpy).toHaveBeenCalledTimes(1));

    const ownDelivered = deliverViaServer(messageRow({ id: 'msg-own' }));
    const foreignDelivered = deliverViaServer(
      messageRow({ id: 'msg-foreign', session_id: FOREIGN_SESSION_ID, content: 'Mensaje ajeno' }),
    );

    // The channel itself rejects the foreign row — the client discard is never reached
    expect(ownDelivered).toBe(true);
    expect(foreignDelivered).toBe(false);

    await waitFor(() => expect(screen.getByText('Hola, hay stock?')).toBeInTheDocument(), {
      timeout: 3000,
    });
    expect(screen.queryByText('Mensaje ajeno')).not.toBeInTheDocument();
  });

  it('renders a message delivered for the subscribed session', async () => {
    render(<OrderChatSection {...baseProps} />);
    await waitFor(() => expect(onSpy).toHaveBeenCalledTimes(1));

    expect(deliverViaServer(messageRow({ id: 'msg-store', is_from_store: true }))).toBe(true);

    await waitFor(() => expect(screen.getByText('Hola, hay stock?')).toBeInTheDocument(), {
      timeout: 3000,
    });
    expect(screen.getByText('Conectado')).toBeInTheDocument();
  });

  it('keeps the client-side discard for a row from another payment of the same session', async () => {
    render(<OrderChatSection {...baseProps} />);
    await waitFor(() => expect(onSpy).toHaveBeenCalledTimes(1));

    // Same session, so the channel delivers it — the payment_id guard must drop it
    expect(
      deliverViaServer(
        messageRow({
          id: 'msg-other-payment',
          payment_id: FOREIGN_PAYMENT_ID,
          content: 'Otro pago',
        }),
      ),
    ).toBe(true);
    expect(deliverViaServer(messageRow({ id: 'msg-own' }))).toBe(true);

    await waitFor(() => expect(screen.getByText('Hola, hay stock?')).toBeInTheDocument(), {
      timeout: 3000,
    });
    expect(screen.queryByText('Otro pago')).not.toBeInTheDocument();
  });
});

// =====================================================
// R17 — nullable buyer PII (design D12)
// =====================================================
// Under the public projection the buyer PII keys are ABSENT, so `buyerEmail` and
// `buyerDni` arrive as null. The chat must still open, and — critically — must
// NOT claim a `dni-{dni}` identity it does not have: the session sync has to fall
// back to the guest identity so an unverified visitor cannot join another buyer's
// thread.
// =====================================================

describe('OrderChatSection — nullable buyer PII (R17)', () => {
  // `buyerName: null` mirrors what page.tsx actually passes, and is what makes
  // the fallback chain reachable at all.
  const nullPiiProps = { ...baseProps, buyerName: null, buyerEmail: null, buyerDni: null };

  it('opens a chat session with a null DNI and the Cliente fallback name', async () => {
    render(<OrderChatSection {...nullPiiProps} />);

    await waitFor(() => expect(mockSyncChatSession).toHaveBeenCalledTimes(1));

    expect(mockSyncChatSession).toHaveBeenCalledWith({
      guestIdFromStorage: null,
      dni: null,
      businessId: 'business-1',
      buyerName: 'Cliente',
      paymentId: PAYMENT_ID,
    });
  });

  it('still reaches the subscribed realtime session with a null buyer identity', async () => {
    render(<OrderChatSection {...nullPiiProps} />);

    // A chat that never subscribes is a chat the buyer cannot see replies on.
    await waitFor(() => expect(channelSpy).toHaveBeenCalledWith(`order-chat-${SESSION_ID}`));
    expect(subscribeSpy).toHaveBeenCalledTimes(1);
  });

  it('prefers the email local part over the Cliente fallback when only the email is known', async () => {
    render(<OrderChatSection {...nullPiiProps} buyerEmail="ana@example.com" />);

    await waitFor(() => expect(mockSyncChatSession).toHaveBeenCalledTimes(1));

    expect(mockSyncChatSession.mock.calls[0][0]).toMatchObject({
      buyerName: 'ana',
      dni: null,
    });
  });
});
