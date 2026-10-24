// =====================================================
// tests/unit/vercelCronConfig.test.ts
// =====================================================
// The reconcile backstop only exists if the platform actually schedules it.
// A cron route that nothing calls is dead code, so the schedule is part of the
// change's contract (spec R4) and is pinned here.
//
// `vercel.json` is the deployment config, not application code: the assertion
// is structural (the entry exists, it points at the reconcile route, it runs
// daily) rather than a behavioural test.
// =====================================================

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

interface VercelCronEntry {
  path: string;
  schedule: string;
}

describe('vercel.json — the reconcile backstop schedule (R4)', () => {
  const config = JSON.parse(readFileSync(join(process.cwd(), 'vercel.json'), 'utf8')) as {
    framework?: string;
    crons?: VercelCronEntry[];
  };

  it('schedules the reconcile backstop', () => {
    expect(Array.isArray(config.crons)).toBe(true);
    const entry = config.crons?.find((cron) => cron.path === '/api/cron/reconcile-payments');
    expect(entry).toBeDefined();
  });

  it('runs it daily, outside the payment peak hours', () => {
    const entry = config.crons?.find((cron) => cron.path === '/api/cron/reconcile-payments');
    expect(entry?.schedule).toBe('0 3 * * *');
  });

  it('keeps the deployment config a Next.js app', () => {
    expect(config.framework).toBe('nextjs');
  });
});
