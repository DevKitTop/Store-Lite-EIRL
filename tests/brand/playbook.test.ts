import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('brand/content playbook', () => {
  const playbookPath = join(process.cwd(), 'docs', 'BRAND_CONTENT_PLAYBOOK.md');

  it('exists at docs/BRAND_CONTENT_PLAYBOOK.md', () => {
    expect(existsSync(playbookPath)).toBe(true);
  });

  it('contains required sections', () => {
    const content = readFileSync(playbookPath, 'utf-8').toLowerCase();
    expect(content).toMatch(/voice\s*[/&]\s*tone|voice and tone/);
    expect(content).toMatch(/\bicp\b|ideal customer|peruvian small business/);
    expect(content).toMatch(/pillar/);
    expect(content).toMatch(/per-platform|tiktok/);
    expect(content).toMatch(/cta|call to action/);
    expect(content).toMatch(/off-?brand/);
    expect(content).toMatch(/version/);
  });
});
