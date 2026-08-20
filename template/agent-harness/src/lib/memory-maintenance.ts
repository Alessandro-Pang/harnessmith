import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { parseFrontmatter } from './frontmatter.js';
import { markdownFiles } from './memory-path.js';

export interface MemoryMaintenanceReport {
  version: 1;
  root: string;
  totalFiles: number;
  unindexed: string[];
  expiredWorking: string[];
  closed: string[];
}

function portablePath(root: string, path: string): string {
  return relative(root, path).replaceAll('\\', '/');
}

export function memoryMaintenanceReport(root: string, today: string): MemoryMaintenanceReport {
  const files = markdownFiles(root, { archive: false });
  const indexed = new Set<string>();
  const documents = files.map((path) => {
    const content = readFileSync(path, 'utf8');
    const metadata = parseFrontmatter(content);
    if (metadata.get('memory-kind') === 'index') {
      for (const match of content.matchAll(/memory:([A-Za-z0-9_./-]+)/g)) {
        indexed.add(match[1].replace(/\.md$/, ''));
      }
    }
    return { path, name: portablePath(root, path), metadata };
  });

  const active = new Set(['active', 'blocked']);
  const closedStatuses = new Set(['complete', 'superseded']);
  const unindexed: string[] = [];
  const expiredWorking: string[] = [];
  const closed: string[] = [];
  for (const { name, metadata } of documents) {
    if (metadata.get('memory-kind') === 'index') continue;
    const status = String(metadata.get('status') || '');
    const reference = name.replace(/\.md$/, '');
    if (active.has(status) && !indexed.has(reference)) unindexed.push(name);
    if (
      active.has(status) &&
      metadata.get('memory-kind') === 'working' &&
      typeof metadata.get('expires') === 'string' &&
      String(metadata.get('expires')) < today
    ) {
      expiredWorking.push(name);
    }
    if (closedStatuses.has(status)) closed.push(name);
  }

  return {
    version: 1,
    root,
    totalFiles: files.length,
    unindexed: unindexed.sort(),
    expiredWorking: expiredWorking.sort(),
    closed: closed.sort(),
  };
}
