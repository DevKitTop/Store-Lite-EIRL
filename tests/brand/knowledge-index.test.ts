/* eslint-disable unicorn/filename-case -- task-mandated brand test path */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseKnowledgeIndex } from '../../brand/load-index';

describe('brand/knowledge-index', () => {
  const indexPath = join(process.cwd(), 'brand', 'knowledge-index.yaml');

  it('exists at brand/knowledge-index.yaml', () => {
    expect(existsSync(indexPath)).toBe(true);
  });

  it('has a non-empty always_load list', () => {
    const parsed = parseKnowledgeIndex(readFileSync(indexPath, 'utf-8'));
    expect(Array.isArray(parsed.always_load)).toBe(true);
    expect(parsed.always_load.length).toBeGreaterThan(0);
    expect(parsed.always_load).toContain('docs/BRAND_CONTENT_PLAYBOOK.md');
  });

  it('every doc entry has path, purpose and non-empty tags', () => {
    const parsed = parseKnowledgeIndex(readFileSync(indexPath, 'utf-8'));
    expect(parsed.docs.length).toBeGreaterThan(0);
    for (const doc of parsed.docs) {
      expect(typeof doc.path).toBe('string');
      expect(doc.path.length).toBeGreaterThan(0);
      expect(typeof doc.purpose).toBe('string');
      expect(doc.purpose.length).toBeGreaterThan(0);
      expect(Array.isArray(doc.tags)).toBe(true);
      expect(doc.tags.length).toBeGreaterThan(0);
    }
  });

  it('records a version identifier', () => {
    const parsed = parseKnowledgeIndex(readFileSync(indexPath, 'utf-8'));
    expect(typeof parsed.version).toBe('number');
  });
});
