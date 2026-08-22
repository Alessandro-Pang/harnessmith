import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { parseFrontmatter } from './frontmatter.js';
import { markdownFiles } from './memory-path.js';
import { contentMemoryReferences } from './memory-validation.js';

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
  const documents = files.map((path) => {
    const content = readFileSync(path, 'utf8');
    const metadata = parseFrontmatter(content);
    const references = contentMemoryReferences(content).map((reference) =>
      reference.replace(/\.md$/, ''),
    );
    return { path, name: portablePath(root, path), metadata, references };
  });
  const byReference = new Map(
    documents.map((document) => [document.name.replace(/\.md$/, ''), document]),
  );
  const reachable = new Set<string>();
  const pending = byReference.has('core') ? ['core'] : [];
  while (pending.length > 0) {
    const reference = pending.pop();
    if (!reference || reachable.has(reference)) continue;
    reachable.add(reference);
    const document = byReference.get(reference);
    if (!document) continue;
    for (const child of document.references) {
      if (byReference.has(child) && !reachable.has(child)) pending.push(child);
    }
  }

  const active = new Set(['active', 'blocked']);
  const closedStatuses = new Set(['complete', 'superseded']);
  const unindexed: string[] = [];
  const expiredWorking: string[] = [];
  const closed: string[] = [];
  for (const { name, metadata } of documents) {
    if (name === 'README.md' || name === 'core.md') continue;
    const status = String(metadata.get('status') || '');
    const reference = name.replace(/\.md$/, '');
    if (active.has(status) && !reachable.has(reference)) unindexed.push(name);
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
