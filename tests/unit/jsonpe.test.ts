import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@/config/env', () => ({
  env: {
    jsonpeSmsToken: 'test-jsonpe-token',
  },
}));

import { sendSms } from '@/lib/sms/jsonpe';

const API_URL = 'https://api.sms.json.pe/send';

beforeEach(() => {
  vi.restoreAllMocks();
});

// =====================================================
// sendSms — Unit tests
// =====================================================

describe('sendSms', () => {
  test('sends POST request with correct URL, headers, and body', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ success: true, message_id: 'msg-001' }),
    });
    vi.stubGlobal('fetch', mockFetch);
    vi.spyOn(console, 'log').mockImplementation(() => {});

    await sendSms('51999999999', 'Pedido confirmado');

    expect(mockFetch).toHaveBeenCalledWith(
      API_URL,
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-jsonpe-token',
        },
        body: JSON.stringify({ number: '51999999999', message: 'Pedido confirmado' }),
      }),
    );
  });

  test('strips + prefix from phone number before sending', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ success: true, message_id: 'msg-002' }),
    });
    vi.stubGlobal('fetch', mockFetch);
    vi.spyOn(console, 'log').mockImplementation(() => {});

    await sendSms('+51999999999', 'Test');

    expect(mockFetch).toHaveBeenCalledWith(
      API_URL,
      expect.objectContaining({
        body: JSON.stringify({ number: '51999999999', message: 'Test' }),
      }),
    );
  });

  test('logs API error message when JSON.pe returns success: false', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ success: false, message: 'Insufficient credits' }),
      }),
    );
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await sendSms('51999999999', 'Error test');

    expect(errorSpy).toHaveBeenCalledWith('[ERROR] JSON.pe: API error', {
      message: 'Insufficient credits',
    });
  });

  test('logs network error and does NOT throw on fetch rejection', async () => {
    const networkError = new Error('Network failure');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(networkError));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(sendSms('51999999999', 'Net error')).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith('[ERROR] JSON.pe: network error', {
      error: 'Network failure',
    });
  });

  test('handles empty message string', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ success: true, message_id: 'msg-empty' }),
    });
    vi.stubGlobal('fetch', mockFetch);
    vi.spyOn(console, 'log').mockImplementation(() => {});

    await sendSms('51999999999', '');

    expect(mockFetch).toHaveBeenCalledWith(
      API_URL,
      expect.objectContaining({
        body: JSON.stringify({ number: '51999999999', message: '' }),
      }),
    );
  });

  test('preserves a phone number already without + prefix', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ success: true, message_id: 'msg-no-prefix' }),
    });
    vi.stubGlobal('fetch', mockFetch);
    vi.spyOn(console, 'log').mockImplementation(() => {});

    await sendSms('51999999999', 'No plus');

    expect(mockFetch).toHaveBeenCalledWith(
      API_URL,
      expect.objectContaining({
        body: JSON.stringify({ number: '51999999999', message: 'No plus' }),
      }),
    );
  });
});
