import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';

import {
  exceedsBudget,
  extractFirstLoadScripts,
  summarize,
} from '../../scripts/measure-first-load-js';

const PAGE_HTML = `<!doctype html><html><head>
<link rel="modulepreload" href="/_next/static/chunks/first.js">
<link href="/_next/static/chunks/second.js" rel="modulepreload">
<script src="/_next/static/chunks/first.js"></script>
<script src="https://cdn.third-party.test/analytics.js"></script>
<script>window.inline = true</script>
</head><body><script src="/_next/static/chunks/third.js" async></script></body></html>`;

describe('extractFirstLoadScripts', () => {
  it('keeps same-origin scripts and preloads, resolving them and dropping duplicates', () => {
    expect(extractFirstLoadScripts(PAGE_HTML, 'https://site.test/')).toEqual([
      'https://site.test/_next/static/chunks/first.js',
      'https://site.test/_next/static/chunks/second.js',
      'https://site.test/_next/static/chunks/third.js',
    ]);
  });

  it('ignores third-party origins and inline scripts', () => {
    const urls = extractFirstLoadScripts(PAGE_HTML, 'https://site.test/');
    expect(urls.some((url) => url.includes('third-party.test'))).toBe(false);
    expect(urls.some((url) => url.includes('inline'))).toBe(false);
  });
});

describe('summarize', () => {
  it('reports raw bytes, per-file gzip total and file count', () => {
    const repeated = Buffer.from('const value = 1;\n'.repeat(200), 'utf8');
    const result = summarize([
      { url: 'https://site.test/a.js', bytes: repeated },
      { url: 'https://site.test/b.js', bytes: repeated },
    ]);

    expect(result.files).toBe(2);
    expect(result.raw).toBe(repeated.length * 2);
    expect(result.gzip).toBeGreaterThan(0);
    expect(result.gzip).toBeLessThan(result.raw);
  });

  it('returns zeroes for an empty payload set', () => {
    expect(summarize([])).toEqual({ files: 0, raw: 0, gzip: 0 });
  });
});

describe('exceedsBudget', () => {
  it('compares the gzip total against the budget in kilobytes', () => {
    expect(exceedsBudget(700 * 1024, 655)).toBe(true);
    expect(exceedsBudget(600 * 1024, 655)).toBe(false);
  });

  it('never fails when no budget is configured', () => {
    expect(exceedsBudget(10 * 1024 * 1024, null)).toBe(false);
  });
});
