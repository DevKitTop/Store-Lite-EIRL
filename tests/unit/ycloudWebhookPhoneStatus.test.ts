// =====================================================
// POST /api/webhooks/ycloud — whatsapp.phone_number.updated
// + smb.app.state.sync
// Regression: YCloud reports UPPERCASE 'CONNECTED'; the
// handler previously compared against lowercase 'connected'
// and never activated the channel. The owner MUST activate
// ONLY on exact UPPERCASE CONNECTED.
// =====================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const updateSet = vi.fn();
  const update = vi.fn(() => ({
    set: vi.fn((values: Record<string, unknown>) => {
      updateSet(values);
      return { where: vi.fn(() => Promise.resolve([values])) };
    }),
  }));
  return { updateSet, update };
});

vi.mock('@/core/database/client', () => ({
  db: { update: mocks.update },
}));

// Dev-mode (NODE_ENV !== 'production') + no webhook secret → signature
// verification is skipped, so the route can be exercised end-to-end.
vi.mock('@/config/env', () => ({
  env: { ycloudWebhookSecret: '' },
}));

import { POST } from '@/app/api/webhooks/ycloud/route';

function webhookRequest(payload: Record<string, unknown>): Request {
  return new Request('http://localhost/api/webhooks/ycloud', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

describe('POST /api/webhooks/ycloud — phone status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('activates the owner on UPPERCASE CONNECTED', async () => {
    const response = await POST(
      webhookRequest({
        id: 'evt-connected-1',
        type: 'whatsapp.phone_number.updated',
        phone_number: {
          id: 'ycloud-phone-1',
          display_phone_number: '+51999999999',
          status: 'CONNECTED',
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    expect(mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        isActive: true,
        connectionStatus: 'connected',
        connectedAt: expect.any(Date),
        displayPhoneNumber: '+51999999999',
      }),
    );
  });

  it('does NOT activate on lowercase "connected"', async () => {
    const response = await POST(
      webhookRequest({
        id: 'evt-lowercase-2',
        type: 'whatsapp.phone_number.updated',
        phone_number: { id: 'ycloud-phone-2', status: 'connected' },
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionStatus: 'pending',
      }),
    );
    expect(mocks.updateSet).not.toHaveBeenCalledWith(expect.objectContaining({ isActive: true }));
  });

  it('does NOT activate on REJECTED; persists failed', async () => {
    const response = await POST(
      webhookRequest({
        id: 'evt-rejected-3',
        type: 'whatsapp.phone_number.updated',
        phone_number: { id: 'ycloud-phone-3', status: 'REJECTED' },
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ connectionStatus: 'failed' }),
    );
    expect(mocks.updateSet).not.toHaveBeenCalledWith(expect.objectContaining({ isActive: true }));
  });

  it('DEACTIVATES the channel and clears connectedAt on DISCONNECTED', async () => {
    const response = await POST(
      webhookRequest({
        id: 'evt-disconnected-5',
        type: 'whatsapp.phone_number.updated',
        phone_number: {
          id: 'ycloud-phone-5',
          display_phone_number: '+51999999999',
          status: 'DISCONNECTED',
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionStatus: 'failed',
        isActive: false,
        connectedAt: null,
      }),
    );
  });

  it('2xx-acks smb.app.state.sync without any channel write', async () => {
    const response = await POST(
      webhookRequest({
        id: 'evt-sync-4',
        type: 'smb.app.state.sync',
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    expect(mocks.updateSet).not.toHaveBeenCalled();
  });
});
