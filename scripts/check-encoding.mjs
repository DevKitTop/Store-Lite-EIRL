#!/usr/bin/env node
/**
 * Rejects tracked source files that are not plain UTF-8 text.
 *
 * Guards against the failure mode where a shell redirect (PowerShell's `>` writes
 * UTF-16LE) silently replaces a source file with a binary blob. ESLint reports
 * those files as "File appears to be binary", which hides every real error behind
 * a parse failure.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const TEXT_EXTENSIONS = new Set([
  '.cjs',
  '.css',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.md',
  '.mjs',
  '.mts',
  '.sh',
  '.sql',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.yaml',
  '.yml',
]);

const UTF16_BOMS = [
  [0xff, 0xfe],
  [0xfe, 0xff],
];

function trackedFiles() {
  const output = execFileSync('git', ['ls-files', '-z'], { encoding: 'buffer' });
  return output.toString('utf8').split('\0').filter(Boolean);
}

function extensionOf(file) {
  const dot = file.lastIndexOf('.');
  return dot === -1 ? '' : file.slice(dot).toLowerCase();
}

function startsWithBom(bytes, bom) {
  return bytes.length >= bom.length && bom.every((byte, index) => bytes[index] === byte);
}

const problems = [];

for (const file of trackedFiles()) {
  if (!TEXT_EXTENSIONS.has(extensionOf(file))) continue;

  let bytes;
  try {
    bytes = readFileSync(file);
  } catch {
    // Deleted in the working tree; `git ls-files` can lag behind.
    continue;
  }

  const bom = UTF16_BOMS.find((candidate) => startsWithBom(bytes, candidate));
  if (bom) {
    problems.push(`${file}: UTF-16 BOM detected (re-encode the file as UTF-8)`);
    continue;
  }

  if (bytes.includes(0)) {
    problems.push(`${file}: NUL byte detected (file is not plain UTF-8 text)`);
    continue;
  }

  const text = bytes.toString('utf8');
  if (Buffer.from(text, 'utf8').compare(bytes) !== 0) {
    problems.push(`${file}: invalid UTF-8 byte sequence`);
  }
}

if (problems.length > 0) {
  console.error('encoding check FAILED:');
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

console.log('encoding check OK - all tracked text files are plain UTF-8');
