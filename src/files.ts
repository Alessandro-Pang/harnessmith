import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
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

export function digestPath(
  path: string,
  { exclude = () => false }: { exclude?: (relativePath: string) => boolean } = {},
): string | null {
  if (!existsSync(path)) return null;
  const hash = createHash('sha256');
  const pending: Array<{ path: string; relative: string }> = [{ path, relative: '' }];
  while (pending.length > 0) {
    const item = pending.pop();
    if (!item) continue;
    if (item.relative && exclude(item.relative)) continue;
    const stat = lstatSync(item.path);
    if (stat.isDirectory()) {
      hash.update(`directory:${item.relative}\n`);
      const entries = readdirSync(item.path, { withFileTypes: true }).sort((a, b) =>
        b.name.localeCompare(a.name),
      );
      for (const entry of entries) {
        pending.push({
          path: join(item.path, entry.name),
          relative: item.relative ? join(item.relative, entry.name) : entry.name,
        });
      }
    } else if (stat.isFile()) {
      hash.update(`file:${item.relative}:${stat.mode & 0o777}\n`);
      hash.update(readFileSync(item.path));
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
