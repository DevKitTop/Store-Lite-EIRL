/* eslint-disable security/detect-non-literal-fs-filename, security/detect-non-literal-regexp */
/**
 * Guards the server/client environment boundary.
 *
 * `src/config/env.ts` holds server-only secrets and throws when they are
 * missing in production. Next.js only inlines `NEXT_PUBLIC_*` variables into
 * the browser bundle, so importing that module from anything reachable by a
 * `'use client'` module makes every page throw
 * "SUPABASE_SERVICE_ROLE_KEY is required in production" in the browser.
 *
 * This test walks the import graph starting at every `'use client'` module and
 * fails when a server-only env module is reachable from the client graph.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const SOURCE_DIRS = ['app', 'src'];
const CODE_EXTENSIONS = ['.ts', '.tsx'];
const SKIPPED_DIRS = new Set([
  'node_modules',
  '.next',
  '.turbo',
  '.vercel',
  'coverage',
  'dist',
  'build',
  'out',
  'playwright-report',
  'test-results',
]);
/** Modules that must never be reachable from the browser bundle. */
const SERVER_ONLY_MODULES = [path.resolve(ROOT, 'src/config/env.ts')];
const PUBLIC_ENV_MODULE = path.resolve(ROOT, 'src/config/env.public.ts');
/** Server-only secrets that must never appear in the public env module. */
const FORBIDDEN_PUBLIC_ENV_REFERENCES = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'JSON_TOKEN',
  'TWILIO_AUTH_TOKEN',
  'JSONPE_SMS_TOKEN',
  'CULQI_WEBHOOK_PASS',
  'RESEND_API_KEY',
  'OTP_HASH_SECRET',
  'ORDER_ACCESS_COOKIE_SECRET',
  'CRON_SECRET',
  'SASS_API_KEY',
  'META_CAPI_ACCESS_TOKEN',
  'YCLOUD_API_KEY',
  'YCLOUD_WEBHOOK_SECRET',
];

function walkSourceFiles(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIPPED_DIRS.has(entry.name)) continue;
      walkSourceFiles(path.join(dir, entry.name), files);
    } else if (CODE_EXTENSIONS.includes(path.extname(entry.name))) {
      files.push(path.join(dir, entry.name));
    }
  }
  return files;
}

/** A directive must be its own statement, optionally after comments. */
function hasDirective(file: string, directive: 'use client' | 'use server'): boolean {
  const head = readFileSync(file, 'utf8').split(/\r?\n/).slice(0, 20);
  const pattern = new RegExp(`^(['"])${directive}\\1;?$`);
  return head.some((line) => pattern.test(line.trim()));
}

function isClientModule(file: string): boolean {
  return hasDirective(file, 'use client');
}

function importSpecifiers(file: string): string[] {
  const specifiers: string[] = [];
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.includes('from') && !trimmed.startsWith('import ')) continue;
    // Type-only imports are erased at build time and cannot pull runtime code in.
    if (/^(import|export)\s+type\b/.test(trimmed)) continue;
    const match =
      /^(?:import|export)\b[^'"]*?\bfrom\s*['"]([^'"]+)['"]/.exec(trimmed) ??
      /^(?:import|export)\s*['"]([^'"]+)['"]/.exec(trimmed) ??
      /^\}\s*from\s*['"]([^'"]+)['"]/.exec(trimmed) ??
      /^from\s*['"]([^'"]+)['"]/.exec(trimmed);
    if (match) specifiers.push(match[1]);
  }
  return specifiers;
}

function resolveSpecifier(fromFile: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith('@/')) base = path.join(ROOT, 'src', specifier.slice(2));
  else if (specifier.startsWith('@app/')) base = path.join(ROOT, 'app', specifier.slice(5));
  else if (specifier.startsWith('.')) base = path.resolve(path.dirname(fromFile), specifier);
  else return null;

  const candidates = [
    base,
    ...CODE_EXTENSIONS.map((ext) => `${base}${ext}`),
    ...CODE_EXTENSIONS.map((ext) => path.join(base, `index${ext}`)),
  ];
  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isFile()) return path.resolve(candidate);
    } catch {
      // Not every candidate exists; keep probing.
    }
  }
  return null;
}

function clientReachableModules(): Map<string, string> {
  const files = SOURCE_DIRS.flatMap((dir) => walkSourceFiles(path.join(ROOT, dir)));
  const roots = files.filter(isClientModule);
  const reachable = new Map<string, string>();
  const queue: { file: string; via: string }[] = roots.map((file) => ({ file, via: file }));

  while (queue.length > 0) {
    const { file, via } = queue.shift()!;
    if (reachable.has(file)) continue;
    reachable.set(file, via);
    // `'use server'` modules are compiled into action references: their imports
    // never enter the browser bundle, so the walk stops there.
    if (hasDirective(file, 'use server')) continue;
    for (const specifier of importSpecifiers(file)) {
      const resolved = resolveSpecifier(file, specifier);
      if (resolved && !reachable.has(resolved)) queue.push({ file: resolved, via });
    }
  }

  return reachable;
}

describe('server/client env boundary', () => {
  const reachable = clientReachableModules();

  it('never reaches a server-only env module from a client module', () => {
    const leaks = SERVER_ONLY_MODULES.filter((module) => reachable.has(module)).map((module) => {
      const relative = path.relative(ROOT, module).replace(/\\/g, '/');
      const via = path.relative(ROOT, reachable.get(module)!).replace(/\\/g, '/');
      return `${relative} reachable from client module ${via}`;
    });

    expect(leaks).toEqual([]);
  });

  it('keeps server secrets out of the public env module', () => {
    const content = readFileSync(PUBLIC_ENV_MODULE, 'utf8');
    const leaked = FORBIDDEN_PUBLIC_ENV_REFERENCES.filter((name) => content.includes(name));

    expect(leaked).toEqual([]);
  });
});
