import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * C8 — secret hygiene guards.
 *
 * The production audit (AUDITORIA-PRODUCCION.md § C8) flagged a real Supabase
 * project ref leaked in tracked files and asked for placeholder-only env
 * templates. These structural tests pin the invariants so a future edit cannot
 * silently reintroduce a hardcoded ref, a real DB host, or a tracked CLI cache.
 */
describe('secret hygiene (C8)', () => {
  const repoRoot = process.cwd();

  it('migrate script resolves the Supabase project id from the environment', () => {
    const script = readFileSync(join(repoRoot, 'scripts', 'migrate.js'), 'utf8');

    expect(script).toContain('process.env.SUPABASE_PROJECT_ID');
    expect(script).toMatch(/SUPABASE_PROJECT_ID\s*=\s*process\.env\.SUPABASE_PROJECT_ID/);
    // The concrete project ref must never be hardcoded again.
    expect(script).not.toContain('likloeyrdzfsrwelpdoz');
  });

  it('env template documents the project id as a placeholder, never a real ref', () => {
    const example = readFileSync(join(repoRoot, '.env.example'), 'utf8');

    expect(example).toContain('SUPABASE_PROJECT_ID=your-project-ref');
    expect(example).not.toContain('likloeyrdzfsrwelpdoz');
    // The DB URLs must stay on the placeholder host, never a real <ref>.supabase.co
    expect(example).toMatch(/db\.project\.supabase\.co/);
    expect(example).not.toMatch(/db\.[a-z]{20}\.supabase\.co/);
  });

  it('gitignore covers the runtime logs and the Supabase CLI cache', () => {
    const ignore = readFileSync(join(repoRoot, '.gitignore'), 'utf8');

    expect(ignore).toMatch(/^\*\.log$/m);
    expect(ignore).toMatch(/^supabase\/\.temp\/$/m);
  });
});
