// =====================================================
// POST /api/webhooks/ycloud — whatsapp.template.reviewed
// Regression: YCloud webhooks send UPPERCASE statuses; the
// handler must persist them LOWERCASE.
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

describe('POST /api/webhooks/ycloud — template review', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('persists an UPPERCASE reviewed status as lowercase', async () => {
    const response = await POST(
      webhookRequest({
        id: 'evt-approved-1',
        type: 'whatsapp.template.reviewed',
        template: { id: 'meta-tpl-1', status: 'APPROVED' },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    expect(mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ metaStatus: 'approved', metaTemplateId: 'meta-tpl-1' }),
    );
  });

  it('persists REJECTED as lowercase too', async () => {
    const response = await POST(
      webhookRequest({
        id: 'evt-rejected-2',
        type: 'whatsapp.template.reviewed',
        template: { id: 'meta-tpl-2', status: 'REJECTED' },
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ metaStatus: 'rejected' }),
    );
  });

  it('falls back to pending when the webhook omits the status field', async () => {
    const response = await POST(
      webhookRequest({
        id: 'evt-nostatus-3',
        type: 'whatsapp.template.reviewed',
        template: { id: 'meta-tpl-3' },
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ metaStatus: 'pending', metaTemplateId: 'meta-tpl-3' }),
    );
  });
});