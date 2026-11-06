import { beforeEach, describe, expect, it, vi } from 'vitest';

const createSignedUrl = vi.fn();
const createSignedUrls = vi.fn();
const from = vi.fn((_bucket: string) => ({ createSignedUrl, createSignedUrls }));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ storage: { from } }),
}));

vi.mock('@/config/env', () => ({
  env: { supabaseUrl: 'https://example.supabase.co', supabaseServiceRoleKey: 'service-role' },
}));

const { getSignedTicketUrl, getSignedTicketUrls } = await import('../signedTicket');

beforeEach(() => {
  createSignedUrl.mockReset();
  createSignedUrls.mockReset();
  from.mockClear();
});

describe('getSignedTicketUrl', () => {
  it('signs a bare object path', async () => {
    createSignedUrl.mockResolvedValue({
      data: { signedUrl: 'https://signed/one' },
      error: null,
    });

    await expect(getSignedTicketUrl('ORD-A.png')).resolves.toBe('https://signed/one');
    expect(createSignedUrl).toHaveBeenCalledWith('ORD-A.png', 3600);
  });

  it('signs the path recovered from a legacy public URL', async () => {
    createSignedUrl.mockResolvedValue({
      data: { signedUrl: 'https://signed/legacy' },
      error: null,
    });

    await expect(
      getSignedTicketUrl('https://example.supabase.co/storage/v1/object/public/tickets/x/y.png'),
    ).resolves.toBe('https://signed/legacy');
    expect(createSignedUrl).toHaveBeenCalledWith('x/y.png', 3600);
  });

  it('returns null without calling storage when the value does not resolve', async () => {
    await expect(getSignedTicketUrl(null)).resolves.toBeNull();
    await expect(getSignedTicketUrl('https://elsewhere.example.com/y.png')).resolves.toBeNull();
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it('returns null when storage rejects the signature', async () => {
    createSignedUrl.mockResolvedValue({ data: null, error: { message: 'missing object' } });

    await expect(getSignedTicketUrl('ORD-A.png')).resolves.toBeNull();
  });

  it('signs a plan receipt in the plan bucket', async () => {
    createSignedUrl.mockResolvedValue({
      data: { signedUrl: 'https://signed/plan' },
      error: null,
    });

    await expect(
      getSignedTicketUrl(
        'https://example.supabase.co/storage/v1/object/public/tickets_plans/B001-00000001.png',
      ),
    ).resolves.toBe('https://signed/plan');
    expect(from).toHaveBeenCalledWith('tickets_plans');
    expect(createSignedUrl).toHaveBeenCalledWith('B001-00000001.png', 3600);
  });
});

describe('getSignedTicketUrls', () => {
  it('keeps positions aligned and leaves unsignable slots null', async () => {
    createSignedUrls.mockResolvedValue({
      data: [
        { path: 'a.png', signedUrl: 'https://signed/a' },
        { path: 'c.png', signedUrl: 'https://signed/c' },
      ],
      error: null,
    });

    await expect(getSignedTicketUrls(['a.png', null, 'c.png'])).resolves.toEqual([
      'https://signed/a',
      null,
      'https://signed/c',
    ]);
    expect(createSignedUrls).toHaveBeenCalledWith(['a.png', 'c.png'], 3600);
  });

  it('signs a path shared by two rows into both slots', async () => {
    createSignedUrls.mockResolvedValue({
      data: [
        { path: 'same.png', signedUrl: 'https://signed/first' },
        { path: 'same.png', signedUrl: 'https://signed/second' },
      ],
      error: null,
    });

    await expect(getSignedTicketUrls(['same.png', 'same.png'])).resolves.toEqual([
      'https://signed/first',
      'https://signed/second',
    ]);
  });

  it('skips storage entirely when nothing is signable', async () => {
    await expect(getSignedTicketUrls([null, undefined, ''])).resolves.toEqual([null, null, null]);
    expect(createSignedUrls).not.toHaveBeenCalled();
  });

  it('settles to nulls when the batch call fails', async () => {
    createSignedUrls.mockResolvedValue({ data: null, error: { message: 'boom' } });

    await expect(getSignedTicketUrls(['a.png'])).resolves.toEqual([null]);
  });

  it('signs each bucket in its own call and keeps positions', async () => {
    createSignedUrls.mockImplementation(async (paths: string[]) => ({
      data: paths.map((path) => ({ path, signedUrl: `https://signed/${path}` })),
      error: null,
    }));

    const result = await getSignedTicketUrls([
      'https://example.supabase.co/storage/v1/object/public/tickets/a.png',
      null,
      'https://example.supabase.co/storage/v1/object/public/tickets_plans/b.png',
    ]);

    expect(result).toEqual(['https://signed/a.png', null, 'https://signed/b.png']);
    expect(from.mock.calls.map(([bucket]) => bucket).sort()).toEqual(['tickets', 'tickets_plans']);
  });
});
