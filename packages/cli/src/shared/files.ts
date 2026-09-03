import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  opendirSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  readSync,
  rmSync,
  statSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import writeFileAtomic from 'write-file-atomic';
import type { IgnoreFile } from './types.js';

export function timestamp(date = new Date()): string {
  return date.toISOString().replaceAll(':', '').replaceAll('.', '-');
}

export function atomicWrite(path: string, content: string, mode = 0o644): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileAtomic.sync(path, content, { mode });
}

export function copyRenderedTree(
  source: string,
  destination: string,
  render: (content: string, path?: string) => string,
  relative = '',
  include: (relativePath: string) => boolean = () => true,
): void {
  mkdirSync(destination, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = join(source, entry.name);
    const to = join(destination, entry.name);
    const child = relative ? join(relative, entry.name) : entry.name;
    if (!include(child)) continue;
    if (entry.isDirectory()) copyRenderedTree(from, to, render, child, include);
    else if (entry.isFile()) {
      const mode = statSync(from).mode & 0o777;
      atomicWrite(to, render(readFileSync(from, 'utf8'), child), mode);
    }
  }
}

export function removeExact(path: string): void {
  if (existsSync(path)) rmSync(path, { recursive: true, force: true });
}

export interface DigestOptions {
  exclude?: (relativePath: string) => boolean;
  maxEntries?: number;
  maxBytes?: number;
  maxFileBytes?: number;
  maxDepth?: number;
  maxDurationMs?: number;
}

interface DigestBudget {
  maxEntries: number;
  maxBytes: number;
  maxFileBytes: number;
  maxDepth: number;
  deadline: number;
  entries: number;
  bytes: number;
}

const digestDefaults = {
  maxEntries: 100_000,
  maxBytes: 512 * 1024 * 1024,
  maxFileBytes: 128 * 1024 * 1024,
  maxDepth: 64,
  maxDurationMs: 30_000,
};

function positive(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < 1) throw new Error(`Invalid digest ${name}`);
  return resolved;
}

function digestBudget(options: DigestOptions): DigestBudget {
  return {
    maxEntries: positive(options.maxEntries, digestDefaults.maxEntries, 'maxEntries'),
    maxBytes: positive(options.maxBytes, digestDefaults.maxBytes, 'maxBytes'),
    maxFileBytes: positive(options.maxFileBytes, digestDefaults.maxFileBytes, 'maxFileBytes'),
    maxDepth: positive(options.maxDepth, digestDefaults.maxDepth, 'maxDepth'),
    deadline:
      Date.now() + positive(options.maxDurationMs, digestDefaults.maxDurationMs, 'maxDurationMs'),
    entries: 0,
    bytes: 0,
  };
}

function reserveDigestEntry(budget: DigestBudget, path: string, depth: number): void {
  if (Date.now() > budget.deadline) throw new Error(`Digest time budget exceeded: ${path}`);
  if (depth > budget.maxDepth) throw new Error(`Digest depth budget exceeded: ${path}`);
  budget.entries += 1;
  if (budget.entries > budget.maxEntries) throw new Error(`Digest entry budget exceeded: ${path}`);
}

function hashFile(path: string, hash: ReturnType<typeof createHash>, budget: DigestBudget): number {
  const descriptor = openSync(path, 'r');
  const buffer = Buffer.allocUnsafe(64 * 1024);
  let bytes = 0;
  try {
    while (true) {
      if (Date.now() > budget.deadline) throw new Error(`Digest time budget exceeded: ${path}`);
      const length = readSync(descriptor, buffer, 0, buffer.length, null);
      if (length === 0) return bytes;
      bytes += length;
      if (bytes > budget.maxFileBytes) throw new Error(`Digest file byte budget exceeded: ${path}`);
      if (bytes > budget.maxBytes - budget.bytes)
        throw new Error(`Digest total byte budget exceeded: ${path}`);
      hash.update(buffer.subarray(0, length));
    }
  } finally {
    closeSync(descriptor);
  }
}

interface DigestItem {
  path: string;
  relative: string;
  depth: number;
}

function digestChildren(
  item: DigestItem,
  exclude: (relativePath: string) => boolean,
  budget: DigestBudget,
): DigestItem[] {
  const children: DigestItem[] = [];
  const directory = opendirSync(item.path);
  try {
    let entry = directory.readSync();
    while (entry) {
      const relative = item.relative ? join(item.relative, entry.name) : entry.name;
      if (!exclude(relative)) {
        const child = { path: join(item.path, entry.name), relative, depth: item.depth + 1 };
        reserveDigestEntry(budget, child.path, child.depth);
        children.push(child);
      }
      entry = directory.readSync();
    }
  } finally {
    directory.closeSync();
  }
  return children.sort((left, right) => right.relative.localeCompare(left.relative));
}

export function digestPath(path: string, options: DigestOptions = {}): string | null {
  if (!existsSync(path)) return null;
  const exclude = options.exclude ?? (() => false);
  const budget = digestBudget(options);
  const hash = createHash('sha256');
  const pending: DigestItem[] = [{ path, relative: '', depth: 0 }];
  reserveDigestEntry(budget, path, 0);
  while (pending.length > 0) {
    const item = pending.pop();
    if (!item) continue;
    if (item.relative && exclude(item.relative)) continue;
    if (Date.now() > budget.deadline) throw new Error(`Digest time budget exceeded: ${item.path}`);
    const stat = lstatSync(item.path);
    if (stat.isDirectory()) {
      hash.update(`directory:${item.relative}\n`);
      pending.push(...digestChildren(item, exclude, budget));
    } else if (stat.isFile()) {
      if (stat.size > budget.maxFileBytes)
        throw new Error(`Digest file byte budget exceeded: ${item.path}`);
      if (stat.size > budget.maxBytes - budget.bytes)
        throw new Error(`Digest total byte budget exceeded: ${item.path}`);
      hash.update(`file:${item.relative}:${stat.mode & 0o777}\n`);
      budget.bytes += hashFile(item.path, hash, budget);
    } else if (stat.isSymbolicLink()) {
      hash.update(`symlink:${item.relative}:${readlinkSync(item.path)}\n`);
    }
  }
  return hash.digest('hex');
}

export function readJson(path: string): unknown {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function replaceManagedBlock(
  path: string,
  marker: string,
  lines: string[] = [],
  { preserveEmpty = false }: Pick<IgnoreFile, 'preserveEmpty'> = {},
): boolean {
  const start = `# >>> ${marker}`;
  const end = `# <<< ${marker}`;
  const current = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const expression = new RegExp(
    `(?:^|\\n)${escapeRegExp(start)}\\n[\\s\\S]*?${escapeRegExp(end)}(?:\\n|$)`,
    'g',
  );
  const clean = current.replace(expression, '\n').replace(/^\n+|\n+$/g, '');
  const block = lines.length > 0 ? `${start}\n${lines.join('\n')}\n${end}` : '';
  const next = [clean, block].filter(Boolean).join(clean && block ? '\n\n' : '');
  if (next === current.replace(/\n$/, '')) return false;
  if (!next && existsSync(path) && preserveEmpty) atomicWrite(path, '');
  else if (!next && existsSync(path)) removeExact(path);
  else if (next) atomicWrite(path, `${next}\n`);
  return true;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
