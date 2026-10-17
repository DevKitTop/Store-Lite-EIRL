// =====================================================
// repoTextEncoding — tracked text files must not contain NUL bytes
// =====================================================
//
// Rationale: several tracked files were found carrying stray NUL (0x00) bytes,
// always from the same root cause — a UTF-16LE fragment grafted onto an
// otherwise ASCII file, or a generated PowerShell redirect (`>` writes UTF-16LE
// by default) committed by accident. Two real cases:
//
//   .prettierignore  — ended with ".gitignore" encoded as UTF-16LE, so prettier
//                      read ". g i t i g n o r e" and the entry was a no-op.
//   openspec/.../proposal.md — two `\0` escapes had been unescaped into real
//                      NUL bytes, which makes the doc "binary" to git and to
//                      most Markdown tooling.
//
// A NUL byte in a text file is never intentional. Asserting its absence across
// tracked text files is cheap and catches the whole class, regardless of which
// tool produced the corruption.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

/** Extensions that are legitimately binary; NUL bytes are expected there. */
const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.avif',
  '.ico',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.pdf',
  '.zip',
  '.gz',
  '.tgz',
  '.tar',
  '.7z',
  '.mp4',
  '.webm',
  '.mov',
  '.avi',
  '.mp3',
  '.wav',
  '.ogg',
  '.sqlite',
  '.sqlite3',
  '.db',
  '.wasm',
  '.node',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.xlsx',
  '.xls',
  '.docx',
  '.doc',
]);

function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot).toLowerCase();
}

function trackedFiles(): string[] {
  // The command is the fixed literal 'git'; no caller-controlled value is ever
  // used as the executable, so PATH resolution is not attacker-reachable.
  // eslint-disable-next-line sonarjs/no-os-command-from-path
  const out = execFileSync('git', ['ls-files', '-z'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return out.split('\0').filter((p) => p.length > 0);
}

describe('tracked text files contain no NUL bytes', () => {
  test('no tracked text file carries a stray 0x00 byte', () => {
    const offenders: string[] = [];

    for (const path of trackedFiles()) {
      if (BINARY_EXTENSIONS.has(extensionOf(path))) continue;

      let buf: Buffer;
      try {
        // `path` is enumerated from `git ls-files` — the repository's own
        // tracked files, never caller input — so this is a false positive.
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        buf = readFileSync(path);
      } catch {
        // Tracked but absent from this working tree (e.g. partially checked
        // out). Not this test's concern.
        continue;
      }

      if (buf.includes(0)) offenders.push(path);
    }

    expect(offenders).toEqual([]);
  });
});
