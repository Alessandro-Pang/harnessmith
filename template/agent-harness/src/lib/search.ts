import { existsSync, readFileSync } from 'node:fs';
import { extname, sep } from 'node:path';
import type { Io } from '../types.js';
import { listFiles } from './files.js';

const searchableExtensions = new Set(['.md', '.yaml', '.yml']);

export function searchableFiles(
  roots: string[],
  { excludeDirectories = [] }: { excludeDirectories?: string[] } = {},
): string[] {
  const files: string[] = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const path of listFiles(root)) {
      if (path.split(sep).some((part) => excludeDirectories.includes(part))) continue;
      if (searchableExtensions.has(extname(path).toLowerCase())) files.push(path);
    }
  }
  return [...new Set(files)].sort();
}

export function textSearch(
  query: string,
  roots: string[],
  io: Io = console,
  options: { excludeDirectories?: string[] } = {},
): number {
  const needle = query.toLocaleLowerCase();
  let matches = 0;
  for (const path of searchableFiles(roots, options)) {
    const lines = readFileSync(path, 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      if (!line.toLocaleLowerCase().includes(needle)) return;
      io.log(`${path}:${index + 1}:${line}`);
      matches += 1;
    });
  }
  return matches;
}
