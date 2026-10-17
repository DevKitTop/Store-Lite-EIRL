/* eslint-disable unicorn/filename-case -- task-mandated brand test path */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadIndex, parseKnowledgeIndex } from '../../brand/load-index';

describe('brand/load-index', () => {
  const loaderPath = join(process.cwd(), 'brand', 'load-index.ts');

  it('exists at brand/load-index.ts', () => {
    expect(existsSync(loaderPath)).toBe(true);
  });

  it('returns only always_load docs when tags match nothing', () => {
    const result = loadIndex(['nonexistent-tag']);
    expect(result).toEqual(['docs/BRAND_CONTENT_PLAYBOOK.md']);
  });

  it('always includes the playbook even with no tags', () => {
    const result = loadIndex([]);
    expect(result).toContain('docs/BRAND_CONTENT_PLAYBOOK.md');
  });

  it('adds docs whose tags intersect the task tags', () => {
    const result = loadIndex(['audience']);
    expect(result).toContain('docs/BRAND_CONTENT_PLAYBOOK.md');
    expect(result).toContain('docs/SAAS_BUSINESS_LOGIC.md');
    expect(result).not.toContain('docs/UI_GUIDELINES.md');
  });

  it('adds every doc sharing an intersected tag', () => {
    const result = loadIndex(['product']);
    expect(result).toContain('docs/SAAS_TECHNICAL_LOGIC.md');
    expect(result).toContain('openspec/specs/storefront-public-info/spec.md');
    expect(result).not.toContain('docs/SAAS_BUSINESS_LOGIC.md');
  });

  it('never duplicates entries', () => {
    const result = loadIndex(['audience', 'audience', 'business']);
    expect(new Set(result).size).toBe(result.length);
  });
});

describe('brand/load-index > minimal parser', () => {
  const sample = [
    'version: 2',
    'always_load:',
    '  - docs/PLAYBOOK.md',
    'docs:',
    '  - path: README.md',
    '    purpose: Overview',
    '    tags: [identity, positioning]',
    '  - path: docs/B.md',
    '    purpose: "Quoted: purpose"',
    '    tags: [business]',
    'catalog:',
    '  tables: [products, businesses]',
  ].join('\n');

  it('parses version, always_load, docs and inline arrays', () => {
    const parsed = parseKnowledgeIndex(sample);
    expect(parsed.version).toBe(2);
    expect(parsed.always_load).toEqual(['docs/PLAYBOOK.md']);
    expect(parsed.docs).toHaveLength(2);
    expect(parsed.docs[0]).toEqual({
      path: 'README.md',
      purpose: 'Overview',
      tags: ['identity', 'positioning'],
    });
    expect(parsed.docs[1].purpose).toBe('Quoted: purpose');
    expect(parsed.docs[1].tags).toEqual(['business']);
  });

  it('ignores comments and blank lines', () => {
    const withNoise = '# header\n\nalways_load: # inline comment\n  - a.md\n';
    const parsed = parseKnowledgeIndex(withNoise);
    expect(parsed.always_load).toEqual(['a.md']);
  });
});
