// =====================================================
// AUDIT: First-load JavaScript weight of a served page
// =====================================================
// Next 16 no longer prints a size column in the build output, and its
// chunks are flat content-hashed files, so neither the build log nor a
// path glob can tell how much JavaScript a route really ships.
//
// This measures what the browser must download: it fetches the page,
// resolves every same-origin <script src> and <link rel="modulepreload">,
// downloads each asset and reports raw and gzip totals.
//
// Gzip is the number to compare against a budget, because that is what
// crosses the network. Cross-origin assets (analytics, error reporting)
// are excluded on purpose: they are a separate budget and they change
// without the application changing.
//
// Usage:
//   pnpm audit:js --url https://storelite.app --budget-kb 655
//   pnpm audit:js --url http://localhost:3000 --json
//
// Exit code 1 means the gzip total exceeded --budget-kb. Without the
// flag the audit only measures and always exits 0.

import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

export type ScriptPayload = { url: string; bytes: Uint8Array };

export type PayloadSummary = { files: number; raw: number; gzip: number };

const TAG_PATTERN = /<(script|link)\b([^>]*)>/gi;
const SRC_ATTRIBUTE = /\bsrc\s*=\s*["']([^"']+)["']/i;
const HREF_ATTRIBUTE = /\bhref\s*=\s*["']([^"']+)["']/i;
const MODULEPRELOAD_REL = /\brel\s*=\s*["'][^"']*modulepreload[^"']*["']/i;

/**
 * Same-origin scripts the page needs to become interactive, in document
 * order, without duplicates. Third-party origins and inline scripts are
 * not part of the application budget.
 */
export function extractFirstLoadScripts(html: string, baseUrl: string): string[] {
  const base = new URL(baseUrl);
  const seen = new Set<string>();
  const urls: string[] = [];

  for (const match of html.matchAll(TAG_PATTERN)) {
    const tag = match[1].toLowerCase();
    const attributes = match[2] ?? '';

    let candidate: string | undefined;
    if (tag === 'script') {
      candidate = SRC_ATTRIBUTE.exec(attributes)?.[1];
    } else {
      if (!MODULEPRELOAD_REL.test(attributes)) continue;
      candidate = HREF_ATTRIBUTE.exec(attributes)?.[1];
    }
    if (!candidate) continue;

    let resolved: URL;
    try {
      resolved = new URL(candidate, base);
    } catch {
      continue;
    }
    if (resolved.origin !== base.origin) continue;

    const key = resolved.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    urls.push(key);
  }

  return urls;
}

/** Raw bytes plus the per-file gzip total, which is what the network carries. */
export function summarize(payloads: ScriptPayload[]): PayloadSummary {
  let raw = 0;
  let gzip = 0;

  for (const payload of payloads) {
    raw += payload.bytes.byteLength;
    gzip += gzipSync(payload.bytes).byteLength;
  }

  return { files: payloads.length, raw, gzip };
}

/** A null budget means "measure only", never a failure. */
export function exceedsBudget(gzipBytes: number, budgetKb: number | null): boolean {
  if (budgetKb === null) return false;
  return gzipBytes > budgetKb * 1024;
}

function readFlag(argv: string[], name: string): string | undefined {
  const exact = argv.indexOf(name);
  if (exact !== -1) {
    const value = argv[exact + 1];
    return value !== undefined && !value.startsWith('--') ? value : undefined;
  }

  const inline = argv.find((argument) => argument.startsWith(`${name}=`));
  return inline?.slice(name.length + 1);
}

function formatKilobytes(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

async function fetchAsset(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`Asset returned ${response.status}: ${url}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

async function main(argv: string[]): Promise<number> {
  const url = readFlag(argv, '--url') ?? 'https://storelite.app';
  const budgetFlag = readFlag(argv, '--budget-kb');
  const budgetKb = budgetFlag === undefined ? null : Number(budgetFlag);
  const asJson = argv.includes('--json');

  if (budgetKb !== null && (!Number.isFinite(budgetKb) || budgetKb <= 0)) {
    throw new Error(`Invalid --budget-kb value: ${budgetFlag}`);
  }

  const pageResponse = await fetch(url, { redirect: 'follow' });
  if (!pageResponse.ok) {
    throw new Error(`Page returned ${pageResponse.status}: ${url}`);
  }

  const html = await pageResponse.text();
  const scriptUrls = extractFirstLoadScripts(html, pageResponse.url || url);
  if (scriptUrls.length === 0) {
    throw new Error(`No same-origin scripts found on ${url}; the page may not be the app`);
  }

  const payloads: ScriptPayload[] = [];
  for (const scriptUrl of scriptUrls) {
    payloads.push({ url: scriptUrl, bytes: await fetchAsset(scriptUrl) });
  }

  const summary = summarize(payloads);
  const exceeded = exceedsBudget(summary.gzip, budgetKb);

  if (asJson) {
    process.stdout.write(
      `${JSON.stringify({
        url: pageResponse.url || url,
        ...summary,
        budgetKb,
        exceeded,
      })}\n`,
    );
    return exceeded ? 1 : 0;
  }

  const lines = [
    `url:      ${pageResponse.url || url}`,
    `scripts:  ${summary.files}`,
    `raw:      ${formatKilobytes(summary.raw)}`,
    `gzip:     ${formatKilobytes(summary.gzip)}`,
  ];

  if (budgetKb === null) {
    lines.push('budget:   none (pass --budget-kb to enforce one)');
  } else if (exceeded) {
    const over = summary.gzip - budgetKb * 1024;
    lines.push(`budget:   ${budgetKb} KB — EXCEEDED by ${formatKilobytes(over)}`);
  } else {
    const headroom = budgetKb * 1024 - summary.gzip;
    lines.push(`budget:   ${budgetKb} KB — ok, ${formatKilobytes(headroom)} of headroom`);
  }

  process.stdout.write(`${lines.join('\n')}\n`);
  return exceeded ? 1 : 0;
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
