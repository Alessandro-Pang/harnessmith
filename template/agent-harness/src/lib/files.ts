import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  opendirSync,
  openSync,
  readFileSync,
  readlinkSync,
  readSync,
  rmSync,
  statSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import writeFileAtomic from 'write-file-atomic';
import { assertSafePath } from './safe-path.js';

export { listFiles } from './file-discovery.js';

export function atomicWrite(path: string, content: string, mode = 0o644): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileAtomic.sync(path, content, { encoding: 'utf8', mode });
}

export function atomicWriteMany(
  entries: Array<{ path: string; content: string; mode?: number }>,
): void {
  const snapshots = entries.map(({ path }) =>
    existsSync(path)
      ? { existed: true, content: readFileSync(path, 'utf8'), mode: statSync(path).mode & 0o777 }
      : { existed: false, content: '', mode: 0o644 },
  );
  let written = 0;
  try {
    for (const entry of entries) {
      atomicWrite(entry.path, entry.content, entry.mode);
      written += 1;
    }
  } catch (error) {
    for (let index = written - 1; index >= 0; index -= 1) {
      const entry = entries[index];
      const snapshot = snapshots[index];
      if (snapshot.existed) atomicWrite(entry.path, snapshot.content, snapshot.mode);
      else rmSync(entry.path, { force: true });
    }
    throw error;
  }
}

export function writeIfMissing(path: string, content: string, mode = 0o644): boolean {
  if (existsSync(path)) return false;
  atomicWrite(path, content, mode);
  return true;
}

export function sameText(path: string, expected: string): boolean {
  return existsSync(path) && readFileSync(path, 'utf8') === expected;
}

export function shortDigest(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 12);
}

export interface DigestOptions {
  exclude?: (relativePath: string) => boolean;
  maxEntries?: number;
  maxBytes?: number;
  maxFileBytes?: number;
  maxDepth?: number;
  maxDurationMs?: number;
  budget?: DigestBudget;
  rejectSymlinks?: boolean;
  rejectSpecial?: boolean;
  requireRootFile?: boolean;
  baseDepth?: number;
  authorizedRoot?: string;
}

export interface DigestBudget {
  readonly maxEntries: number;
  readonly maxBytes: number;
  readonly maxFileBytes: number;
  readonly maxDepth: number;
  readonly deadline: number;
  entries: number;
  bytes: number;
}

const defaultDigestBudget = {
  maxEntries: 100_000,
  maxBytes: 512 * 1024 * 1024,
  maxFileBytes: 128 * 1024 * 1024,
  maxDepth: 64,
  maxDurationMs: 30_000,
};

function positiveBudget(value: number | undefined, fallback: number, name: string): number {
  const budget = value ?? fallback;
  if (!Number.isInteger(budget) || budget < 1) throw new Error(`Invalid digest ${name}: ${budget}`);
  return budget;
}

export function createDigestBudget(options: DigestOptions = {}): DigestBudget {
  return {
    maxEntries: positiveBudget(options.maxEntries, defaultDigestBudget.maxEntries, 'maxEntries'),
    maxBytes: positiveBudget(options.maxBytes, defaultDigestBudget.maxBytes, 'maxBytes'),
    maxFileBytes: positiveBudget(
      options.maxFileBytes,
      defaultDigestBudget.maxFileBytes,
      'maxFileBytes',
    ),
    maxDepth: positiveBudget(options.maxDepth, defaultDigestBudget.maxDepth, 'maxDepth'),
    deadline:
      Date.now() +
      positiveBudget(options.maxDurationMs, defaultDigestBudget.maxDurationMs, 'maxDurationMs'),
    entries: 0,
    bytes: 0,
  };
}

function assertDigestTime(budget: DigestBudget, path: string): void {
  if (Date.now() > budget.deadline) throw new Error(`Digest time budget exceeded: ${path}`);
}

function reserveEntry(budget: DigestBudget, path: string, depth: number): void {
  assertDigestTime(budget, path);
  if (depth > budget.maxDepth) throw new Error(`Digest depth budget exceeded: ${path}`);
  if (budget.entries >= budget.maxEntries) throw new Error(`Digest entry budget exceeded: ${path}`);
  budget.entries += 1;
}

function hashRegularFile(
  path: string,
  hash: ReturnType<typeof createHash>,
  budget: DigestBudget,
): number {
  const descriptor = openSync(path, 'r');
  const buffer = Buffer.allocUnsafe(64 * 1024);
  let bytes = 0;
  try {
    while (true) {
      assertDigestTime(budget, path);
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

function directoryChildren(
  item: DigestItem,
  exclude: (relativePath: string) => boolean,
  budget: DigestBudget,
): DigestItem[] {
  const children: DigestItem[] = [];
  const directory = opendirSync(item.path);
  try {
    let entry = directory.readSync();
    while (entry) {
      assertDigestTime(budget, item.path);
      const relative = item.relative ? join(item.relative, entry.name) : entry.name;
      if (!exclude(relative)) {
        const child = join(item.path, entry.name);
        reserveEntry(budget, child, item.depth + 1);
        children.push({ path: child, relative, depth: item.depth + 1 });
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
  const budget = options.budget ?? createDigestBudget(options);
  const baseDepth = options.baseDepth ?? 0;
  if (!Number.isInteger(baseDepth) || baseDepth < 0)
    throw new Error(`Invalid digest baseDepth: ${baseDepth}`);
  const hash = createHash('sha256');
  const pending: DigestItem[] = [{ path, relative: '', depth: baseDepth }];
  reserveEntry(budget, path, baseDepth);
  if (options.authorizedRoot) assertSafePath(options.authorizedRoot, path);
  while (pending.length > 0) {
    assertDigestTime(budget, path);
    const item = pending.pop();
    if (!item) continue;
    const stat = lstatSync(item.path);
    if (stat.isDirectory()) {
      if (options.requireRootFile && item.relative === '')
        throw new Error(`File evidence requires a regular file: ${item.path}`);
      hash.update(`directory:${item.relative}\n`);
      pending.push(...directoryChildren(item, exclude, budget));
    } else if (stat.isFile()) {
      if (stat.size > budget.maxFileBytes)
        throw new Error(`Digest file byte budget exceeded: ${item.path}`);
      if (stat.size > budget.maxBytes - budget.bytes)
        throw new Error(`Digest total byte budget exceeded: ${item.path}`);
      hash.update(`file:${item.relative}:${stat.mode & 0o777}\n`);
      budget.bytes += hashRegularFile(item.path, hash, budget);
    } else if (stat.isSymbolicLink()) {
      if (options.rejectSymlinks)
        throw new Error(`Verification scope contains a symbolic link: ${item.path}`);
      hash.update(`symlink:${item.relative}:${readlinkSync(item.path)}\n`);
    } else if (options.rejectSpecial) {
      throw new Error(`Verification scope is not a regular file or directory: ${item.path}`);
    }
  }
  return hash.digest('hex');
}
