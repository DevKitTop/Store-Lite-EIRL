import { toSafeJsonLd } from '@/shared/utils/safeJsonLd';
import { describe, expect, it } from 'vitest';

// U+2028/U+2029 are valid in JSON strings but are line terminators in JS.
const LINE_SEPARATORS = String.fromCharCode(0x2028, 0x2029);

/**
 * JSON-LD payloads are rendered with `<script type="application/ld+json">` and
 * `dangerouslySetInnerHTML`. `JSON.stringify` does NOT escape `<`, so a
 * seller-controlled value containing `</script>` terminates the script element
 * early and lets the remainder of the payload execute as JavaScript (stored XSS
 * against the buyer viewing the storefront). These tests lock the escaper.
 */
describe('toSafeJsonLd', () => {
  it('escapes "<" so a </script> breakout cannot terminate the element', () => {
    const payload = { name: '</script><img src=x onerror=alert(1)>' };
    const out = toSafeJsonLd(payload);

    expect(out).not.toContain('</script>');
    expect(out).toContain('\\u003c');
  });

  it('still round-trips to the original value when parsed', () => {
    const payload = { name: '</script><img src=x onerror=alert(1)>' };

    expect(JSON.parse(toSafeJsonLd(payload))).toEqual(payload);
  });

  it('escapes ">", "&" and the U+2028/U+2029 line terminators', () => {
    const payload = { a: '>', b: '&', c: LINE_SEPARATORS };
    const out = toSafeJsonLd(payload);

    expect(out).toContain('\\u003e');
    expect(out).toContain('\\u0026');
    expect(out).not.toContain(LINE_SEPARATORS[0]);
    expect(out).not.toContain(LINE_SEPARATORS[1]);
    expect(JSON.parse(out)).toEqual(payload);
  });

  it('keeps nested graphs intact and parseable', () => {
    const payload = {
      '@context': 'https://schema.org',
      '@graph': [{ '@type': 'Product', name: 'a<b>c&d' }],
    };

    expect(JSON.parse(toSafeJsonLd(payload))).toEqual(payload);
  });

  it('leaves an innocent payload readable and parseable', () => {
    const payload = { '@type': 'LocalBusiness', name: 'Panadería Sol' };

    expect(toSafeJsonLd(payload)).toContain('Panadería Sol');
    expect(JSON.parse(toSafeJsonLd(payload))).toEqual(payload);
  });
});
