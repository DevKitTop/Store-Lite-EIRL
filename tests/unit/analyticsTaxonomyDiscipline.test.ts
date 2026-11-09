/* eslint-disable security/detect-non-literal-fs-filename -- this guard must walk the source tree */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, test } from 'vitest';

/**
 * The taxonomy is only useful if it is actually the single source of truth.
 * A literal event name in a component silently forks the schema: two spellings
 * for one concept, and dashboards that never match.
 *
 * This guard scans the product source for capture calls that still pass a raw
 * string, so the constant is the only legal way to name an event.
 */

const ROOT = process.cwd();
const SCANNED_DIRS = ['src', 'app'];
const SOURCE_EXTENSIONS = ['.ts', '.tsx'];
const ALLOWED_FILES = new Set(['src/lib/analytics/taxonomy.ts']);

function collectSourceFiles(dir: string): string[] {
  const absolute = join(ROOT, dir);
  const entries = readdirSync(absolute);
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(absolute, entry);
    const stats = statSync(fullPath);

    if (stats.isDirectory()) {
      if (entry === 'node_modules' || entry === '__tests__') continue;
      files.push(...collectSourceFiles(join(dir, entry)));
      continue;
    }

    const isSource = SOURCE_EXTENSIONS.some((extension) => entry.endsWith(extension));
    const isTest = /\.(test|spec)\.tsx?$/.test(entry);

    if (isSource && !isTest) {
      files.push(relative(ROOT, fullPath).replaceAll('\\', '/'));
    }
  }

  return files;
}

const LITERAL_EVENT_PATTERNS = [
  /\.capture\(\s*['"]([a-z][a-z0-9_]*)['"]/g,
  /\bevent:\s*['"]([a-z][a-z0-9_]*)['"]/g,
];

interface Violation {
  file: string;
  event: string;
}

function findLiteralEvents(): Violation[] {
  const violations: Violation[] = [];

  for (const dir of SCANNED_DIRS) {
    for (const file of collectSourceFiles(dir)) {
      if (ALLOWED_FILES.has(file)) continue;

      const content = readFileSync(join(ROOT, file), 'utf8');

      for (const pattern of LITERAL_EVENT_PATTERNS) {
        for (const match of content.matchAll(pattern)) {
          violations.push({ file, event: match[1] });
        }
      }
    }
  }

  return violations;
}

describe('analytics taxonomy discipline', () => {
  test('no capture call names an event with a raw string literal', () => {
    const violations = findLiteralEvents();

    const report = violations
      .map((violation) => `${violation.file} -> ${violation.event}`)
      .join('\n');

    expect(violations, `Use AnalyticsEvents constants instead:\n${report}`).toEqual([]);
  });
});
