import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

const config = readFileSync(path.resolve(process.cwd(), 'next.config.ts'), 'utf8');

describe('next.config.ts PWA worker headers', () => {
  test('sets a revalidating cache policy for the root service worker', () => {
    expect(config).toMatch(/source:\s*'\/sw\.js'/);
    expect(config).toMatch(/key:\s*'Cache-Control',\s*value:\s*'[^']*must-revalidate/);
  });
});
