// =====================================================
// gitignoreDocs — the blanket `*.md` rule must not swallow docs/
// =====================================================
//
// Rationale: .gitignore ignores `*.md` by default to keep auto-generated
// analysis files out of commits. That rule silently excluded the entire
// `docs/` tree from version control, so a fresh clone was missing the
// architecture, compliance, ADR and payment-flow documentation.
//
// This is the exact same failure mode that was already fixed once for
// `openspec/specs/` (see the comment block in .gitignore). The same bug
// then recurred for `docs/`, which is why it is now asserted in CI rather
// than only documented.

import { execFileSync } from 'node:child_process';
import { describe, expect, test } from 'vitest';

/** True when git's ignore rules exclude `path`. */
function isIgnored(path: string): boolean {
  try {
    // Exit 0 => path is ignored. Exit 1 => path is NOT ignored (throws).
    // The command is the fixed literal 'git'; no caller-controlled value is
    // ever used as the executable, so PATH resolution is not attacker-reachable.
    // eslint-disable-next-line sonarjs/no-os-command-from-path
    execFileSync('git', ['check-ignore', '-q', path], {
      cwd: process.cwd(),
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

/** True when git already tracks `path`. */
function isTracked(path: string): boolean {
  try {
    // Same fixed-literal justification as isIgnored above.
    // eslint-disable-next-line sonarjs/no-os-command-from-path
    execFileSync('git', ['ls-files', '--error-unmatch', path], {
      cwd: process.cwd(),
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

describe('project documentation is versioned', () => {
  // These paths MUST stay untracked: git's ignore rules only apply to
  // untracked files, so a tracked path reports as "not ignored" regardless
  // of .gitignore. Using a tracked path here would make this suite pass
  // even with the whitelist removed — a silent no-op guard.
  const versionedDocs = [
    'docs/compliance/05-DATA-PRIVACY.md',
    'docs/compliance/04-SECURITY-CHECKLIST.md',
    'docs/ORDER_PENALTY_SYSTEM.md',
    'docs/ORDER_DISPUTE_SYSTEM.md',
    'docs/roadmap/seo-competitivo.md',
  ];

  test.each(versionedDocs)('%s is NOT git-ignored', (path) => {
    expect(isTracked(path)).toBe(false);
    expect(isIgnored(path)).toBe(false);
  });
});

describe('auto-generated analysis files stay ignored', () => {
  const analysisFiles = ['informe_detallado_archivos_grandes.md', 'tareas_prs_prioritizadas.md'];

  test.each(analysisFiles)('%s is still git-ignored', (path) => {
    expect(isIgnored(path)).toBe(true);
  });
});
