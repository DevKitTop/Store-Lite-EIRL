/* eslint-disable unicorn/filename-case -- task-mandated brand loader path: brand/load-index.ts */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface KnowledgeDoc {
  path: string;
  purpose: string;
  tags: string[];
}

export interface KnowledgeIndex {
  version?: number;
  always_load: string[];
  docs: KnowledgeDoc[];
  catalog?: Record<string, string | string[]>;
}

interface ParseState {
  section: string | null;
  doc: KnowledgeDoc | null;
}

function stripComment(line: string): string {
  let inSingle = false;
  let inDouble = false;
  let depth = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line.charAt(i);
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
    } else if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
    } else if (!inSingle && !inDouble) {
      if (ch === '[') {
        depth++;
      } else if (ch === ']') {
        depth--;
      } else if (ch === '#' && depth === 0 && (i === 0 || /\s/.test(line.charAt(i - 1)))) {
        return line.slice(0, i);
      }
    }
  }
  return line;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseInlineArray(value: string): string[] {
  const inner = value.trim().slice(1, -1);
  if (inner.trim() === '') return [];
  return inner
    .split(',')
    .map((item) => unquote(item))
    .filter((item) => item.length > 0);
}

function assignDocField(doc: KnowledgeDoc, entry: string): void {
  const colon = entry.indexOf(':');
  if (colon === -1) return;
  const key = entry.slice(0, colon).trim();
  const value = entry.slice(colon + 1).trim();
  if (key === 'path') doc.path = unquote(value);
  else if (key === 'purpose') doc.purpose = unquote(value);
  else if (key === 'tags') doc.tags = parseInlineArray(value);
}

function parseTopLevel(content: string, index: KnowledgeIndex, state: ParseState): void {
  const colon = content.indexOf(':');
  if (colon === -1) return;
  const key = content.slice(0, colon).trim();
  state.section = key;
  state.doc = null;
  if (key === 'docs') index.docs = [];
  else if (key === 'always_load') index.always_load = [];
  const value = content.slice(colon + 1).trim();
  if (key === 'version' && value !== '') {
    const n = Number(unquote(value));
    if (!Number.isNaN(n)) index.version = n;
  }
}

function parseDocLine(content: string, index: KnowledgeIndex, state: ParseState): void {
  if (content.startsWith('- ')) {
    state.doc = { path: '', purpose: '', tags: [] };
    index.docs.push(state.doc);
    assignDocField(state.doc, content.slice(2).trim());
  } else if (state.doc) {
    assignDocField(state.doc, content);
  }
}

function parseLine(line: string, index: KnowledgeIndex, state: ParseState): void {
  const indent = line.match(/^ */)?.[0].length ?? 0;
  const content = line.trim();

  if (indent === 0) {
    parseTopLevel(content, index, state);
    return;
  }
  if (state.section === 'always_load' && content.startsWith('- ')) {
    index.always_load.push(unquote(content.slice(2)));
    return;
  }
  if (state.section === 'docs') {
    parseDocLine(content, index, state);
  }
}

/**
 * Minimal parser for the constrained shape used by `brand/knowledge-index.yaml`:
 * top-level scalars, lists of scalars, lists of maps, and flat maps with
 * scalar or inline-array values. Deliberately dependency-free.
 */
export function parseKnowledgeIndex(text: string): KnowledgeIndex {
  const index: KnowledgeIndex = { always_load: [], docs: [] };
  const state: ParseState = { section: null, doc: null };

  for (const line of text.split(/\r?\n/)) {
    const cleaned = stripComment(line);
    if (cleaned.trim() !== '') {
      parseLine(cleaned, index, state);
    }
  }

  return index;
}

/**
 * Resolve the brand knowledge index for a given set of task tags.
 *
 * Always returns the `always_load` documents, then adds any catalog document
 * whose tags intersect the supplied task tags. Order is stable and duplicates
 * are removed.
 */
export function loadIndex(taskTags: string[] = []): string[] {
  const indexPath = join(process.cwd(), 'brand', 'knowledge-index.yaml');
  const parsed = parseKnowledgeIndex(readFileSync(indexPath, 'utf-8'));

  const selected = [...parsed.always_load];

  if (taskTags.length > 0) {
    for (const doc of parsed.docs) {
      if (doc.tags.some((tag) => taskTags.includes(tag))) {
        selected.push(doc.path);
      }
    }
  }

  return [...new Set(selected)];
}

export default loadIndex;
