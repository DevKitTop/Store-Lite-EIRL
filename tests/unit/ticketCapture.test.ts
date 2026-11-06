import type { RefObject } from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const { mockToPng, mockFetch } = vi.hoisted(() => ({
  mockToPng: vi.fn(),
  mockFetch: vi.fn(),
}));

vi.mock('html-to-image', () => ({ toPng: mockToPng }));

const { captureTicketPng } = await import('@/shared/payments/ticketCapture');

function refOf(current: HTMLDivElement | null): RefObject<HTMLDivElement | null> {
  return { current };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockResolvedValue({ blob: async () => new Blob(['png']) });
});

describe('captureTicketPng', () => {
  test('throws when the ref has nothing to capture', async () => {
    await expect(captureTicketPng(refOf(null), { waitMs: 0 })).rejects.toThrow(
      'No se pudo generar el ticket',
    );
    expect(mockToPng).not.toHaveBeenCalled();
  });

  test('throws when the renderer produces no data URL', async () => {
    mockToPng.mockResolvedValue('');

    await expect(
      captureTicketPng(refOf(document.createElement('div')), { waitMs: 0 }),
    ).rejects.toThrow('No se pudo generar el ticket');
  });

  test('returns the PNG blob rendered from the node', async () => {
    const node = document.createElement('div');
    mockToPng.mockResolvedValue('data:image/png;base64,AAA');

    const blob = await captureTicketPng(refOf(node), { waitMs: 0 });

    expect(blob).toBeInstanceOf(Blob);
    expect(mockToPng).toHaveBeenCalledWith(node, expect.objectContaining({ pixelRatio: 2 }));
    expect(mockFetch).toHaveBeenCalledWith('data:image/png;base64,AAA');
  });
});
