import { describe, expect, it } from 'vitest';
import { extractTicketPath } from '../ticketImage';

describe('extractTicketPath', () => {
  it('extracts the object path from a legacy public URL', () => {
    const url =
      'https://likloeyrdzfsrwelpdoz.supabase.co/storage/v1/object/public/tickets/2825d7fb-e9f6-473c-9a1e-4e0db6b2d814/4DFCWBNV.jpg';

    expect(extractTicketPath(url)).toBe('2825d7fb-e9f6-473c-9a1e-4e0db6b2d814/4DFCWBNV.jpg');
  });

  it('decodes percent-encoded segments', () => {
    const url = 'https://example.supabase.co/storage/v1/object/public/tickets/a%20b/c%2Bd.png';

    expect(extractTicketPath(url)).toBe('a b/c+d.png');
  });

  it('accepts a bare object path', () => {
    expect(extractTicketPath('ORD-MTRGMQJ6.png')).toBe('ORD-MTRGMQJ6.png');
  });

  it('strips a query string from a bare path', () => {
    expect(extractTicketPath('ORD-MTRGMQJ6.png?token=abc')).toBe('ORD-MTRGMQJ6.png');
  });

  it('extracts the path from a previously signed URL', () => {
    const url =
      'https://example.supabase.co/storage/v1/object/sign/tickets/ORD-MTRGMQJ6.png?token=eyJhbGci';

    expect(extractTicketPath(url)).toBe('ORD-MTRGMQJ6.png');
  });

  it('rejects a URL from another bucket', () => {
    const url = 'https://example.supabase.co/storage/v1/object/public/products/categories/pic.jpg';

    expect(extractTicketPath(url)).toBeNull();
  });

  it('rejects an unrelated absolute URL', () => {
    expect(extractTicketPath('https://evil.example.com/tickets/steal.png')).toBeNull();
  });

  it('rejects path traversal', () => {
    expect(extractTicketPath('../../etc/passwd')).toBeNull();
    expect(extractTicketPath('a/../../b.png')).toBeNull();
  });

  it('rejects an absolute-looking path', () => {
    expect(extractTicketPath('/etc/passwd')).toBeNull();
  });

  it('rejects empty and missing values', () => {
    expect(extractTicketPath(null)).toBeNull();
    expect(extractTicketPath(undefined)).toBeNull();
    expect(extractTicketPath('')).toBeNull();
    expect(extractTicketPath('   ')).toBeNull();
  });

  it('rejects a bucket URL with no object path', () => {
    expect(
      extractTicketPath('https://example.supabase.co/storage/v1/object/public/tickets/'),
    ).toBeNull();
  });
});
