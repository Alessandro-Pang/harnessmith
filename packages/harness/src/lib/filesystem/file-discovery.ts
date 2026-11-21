import { relative, sep } from 'node:path';
import { fdir } from 'fdir';
import { resolveIntegerBudget } from '../contract/integer-budget.js';

export interface ListFilesOptions {
  maxDepth?: number;
  maxDurationMs?: number;
  maxEntries?: number;
  excludeDirectory?: (path: string) => boolean;
}

const defaultLimits = {
  maxDepth: 64,
  maxDurationMs: 30_000,
  maxEntries: 100_000,
};

function limit(value: number | undefined, fallback: number, name: string, minimum: number): number {
  return resolveIntegerBudget(value, fallback, {
    subject: `file discovery ${name}`,
    minimum,
    error: 'invalid',
    validateFallback: true,
  });
}

export function listFiles(root: string, options: ListFilesOptions = {}): string[] {
  const maxDepth = limit(options.maxDepth, defaultLimits.maxDepth, 'maxDepth', 0);
  const maxDurationMs = limit(
    options.maxDurationMs,
    defaultLimits.maxDurationMs,
    'maxDurationMs',
    1,
  );
  const maxEntries = limit(options.maxEntries, defaultLimits.maxEntries, 'maxEntries', 1);
  const deadline = Date.now() + maxDurationMs;
  let entries = 0;
  const directories = new Set<string>();

  return new fdir({ excludeSymlinks: true })
    .withErrors()
    .withFullPaths()
    .withDirs()
    .exclude((_name, path) => options.excludeDirectory?.(path) ?? false)
    .filter((path, isDirectory) => {
      if (Date.now() > deadline) throw new Error(`File discovery time budget exceeded: ${path}`);
      const depth = relative(root, path).split(sep).filter(Boolean).length;
      if (depth > maxDepth) throw new Error(`File discovery depth budget exceeded: ${path}`);
      if (depth > 0) {
        entries += 1;
        if (entries > maxEntries) throw new Error(`File discovery entry budget exceeded: ${path}`);
      }
      if (isDirectory) directories.add(path);
      return true;
    })
    .crawl(root)
    .sync()
    .filter((path) => !directories.has(path))
    .sort();
}
