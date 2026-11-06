// =====================================================
// 0016 product tenant policies - structural guarantees
//
// These assertions read the migration text. They cannot prove that PostgreSQL
// accepts it or that the policies deny what they should - staging probes do
// that. What they can prove is the ordering and shape that makes the file safe
// to apply: a grant before its RLS would be an open door, and a policy that
// reads a client-supplied id would be decoration.
// =====================================================

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(process.cwd(), 'supabase', 'migrations', '0016_product_tenant_policies.sql'),
  'utf8',
);

const TABLES = ['products', 'product_categories', 'product_media'] as const;

describe('0016 product tenant policies', () => {
  it('enables RLS on every table before granting it to app_runtime', () => {
    for (const table of TABLES) {
      const rls = migration.indexOf(`alter table public.${table} enable row level security`);
      const grant = migration.indexOf(
        `grant select, insert, update, delete on public.${table} to app_runtime`,
      );

      expect(rls).toBeGreaterThan(-1);
      expect(grant).toBeGreaterThan(-1);
      expect(rls).toBeLessThan(grant);
    }
  });

  it('gives every table the four operations', () => {
    for (const table of TABLES) {
      for (const op of ['select', 'insert', 'update', 'delete']) {
        expect(migration).toContain(`on public.${table} for ${op}`);
      }
    }
  });

  it('scopes every policy by membership, never by a client-supplied id', () => {
    const policies = migration.match(/create policy[\s\S]*?;/g) ?? [];

    expect(policies).toHaveLength(12);

    for (const policy of policies) {
      expect(policy).toMatch(/public\.(is_business_member|is_product_member)\(/);
      expect(policy).not.toMatch(/current_setting/);
      expect(policy).not.toMatch(/auth\.uid\(\)\s*=/);
    }
  });

  it('gives product_media an insert check and keeps its policies out of products', () => {
    expect(migration).toMatch(
      /create policy "product_media_insert_member"[\s\S]*?with check \(public\.is_product_member\(product_id\)\)/,
    );

    for (const policy of migration.match(/create policy "product_media_[\s\S]*?;/g) ?? []) {
      expect(policy).not.toMatch(/from\s+public\.products/i);
    }
  });

  it('revokes public execute on the helper before granting it to app_runtime', () => {
    const revoke = migration.indexOf(
      'revoke all on function public.is_product_member(uuid) from public',
    );
    const grant = migration.indexOf(
      'grant execute on function public.is_product_member(uuid) to app_runtime',
    );

    expect(revoke).toBeGreaterThan(-1);
    expect(grant).toBeGreaterThan(revoke);
    expect(migration).toMatch(/security definer[\s\S]*?set search_path to ''/i);
  });
});
