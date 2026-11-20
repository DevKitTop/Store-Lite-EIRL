import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/push/webPushSender', () => ({
  getVapidPublicKey: vi.fn(),
}));

import { GET } from '@/app/api/push/config/route';
import { getVapidPublicKey } from '@/lib/push/webPushSender';

const publicKey = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9lNQxB1F1Z8mXgpZ1lNQxB1F1Z8mXgpZ1lNQ';

describe('GET /api/push/config', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns only the VAPID public key with no-store caching', async () => {
    vi.mocked(getVapidPublicKey).mockReturnValue(publicKey);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(body).toEqual({ publicKey });
    expect(JSON.stringify(body)).not.toContain('VAPID_PRIVATE_KEY');
    expect(JSON.stringify(body)).not.toContain('mailto:');
  });

  it('returns 503 when VAPID is not configured', async () => {
    vi.mocked(getVapidPublicKey).mockReturnValue('');

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({ error: 'Push notifications are not configured.' });
  });
});
