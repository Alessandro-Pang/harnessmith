import { type Dirent, lstatSync, opendirSync, type Stats } from 'node:fs';
import { extname, join } from 'node:path';
import {
  recordSearchSkip,
  type SearchDiscovery,
  type SearchSource,
  searchDeadlineExceeded,
} from './search-budget-contract.js';

const searchableExtensions = new Set(['.md', '.yaml', '.yml']);

interface PendingPath {
  path: string;
  depth: number;
}

function searchTimedOut(discovery: SearchDiscovery, source: SearchSource, path: string): boolean {
  return searchDeadlineExceeded(discovery, source.label, path);
}

function resolvedSearchRoot(path: string): string | null {
  try {
    const stat = lstatSync(path);
    if (stat.isDirectory() || stat.isFile()) return path;
    return null;
  } catch {
    return null;
  }
}

function directoryEntries(
  source: SearchSource,
  item: PendingPath,
  discovery: SearchDiscovery,
): { entries: Dirent[]; exhausted: boolean } | null {
  let directory: ReturnType<typeof opendirSync>;
  try {
    directory = opendirSync(item.path);
  } catch {
    recordSearchSkip(discovery, { source: source.label, path: item.path, reason: 'read-error' });
    return null;
  }
  const entries: Dirent[] = [];
  try {
    while (true) {
      if (searchTimedOut(discovery, source, item.path)) return { entries, exhausted: true };
      const entry = directory.readSync();
      if (!entry) return { entries, exhausted: false };
      if (discovery.stats.entriesVisited === discovery.limits.maxEntries) {
        recordSearchSkip(discovery, {
          source: source.label,
          path: join(item.path, entry.name),
          reason: 'max-entries',
        });
        return { entries, exhausted: true };
      }
      discovery.stats.entriesVisited += 1;
      entries.push(entry);
    }
  } catch {
    recordSearchSkip(discovery, { source: source.label, path: item.path, reason: 'read-error' });
    return { entries, exhausted: false };
  } finally {
    directory.closeSync();
  }
}

function skipSymlink(discovery: SearchDiscovery, source: SearchSource, path: string): void {
  recordSearchSkip(discovery, { source: source.label, path, reason: 'symlink' });
}

function enqueueDirectoryChildren(
  source: SearchSource,
  item: PendingPath,
  discovery: SearchDiscovery,
  excluded: Set<string>,
  pending: PendingPath[],
): boolean {
  const scanned = directoryEntries(source, item, discovery);
  if (!scanned) return false;
  for (const entry of scanned.entries.sort((left, right) =>
    right.name.localeCompare(left.name, 'und'),
  )) {
    const child = join(item.path, entry.name);
    if (entry.isSymbolicLink()) {
      skipSymlink(discovery, source, child);
      continue;
    }
    if (entry.isDirectory() && excluded.has(entry.name.toLowerCase())) continue;
    pending.push({ path: child, depth: item.depth + 1 });
  }
  return scanned.exhausted;
}

function scanSource(
  source: SearchSource,
  sourceIndex: number,
  discovery: SearchDiscovery,
  seenFiles: Set<string>,
): boolean {
  try {
    if (lstatSync(source.root).isSymbolicLink()) {
      skipSymlink(discovery, source, source.root);
      return false;
    }
  } catch {
    return false;
  }
  const root = resolvedSearchRoot(source.root);
  if (!root) return false;
  const excluded = new Set((source.excludeDirectories || []).map((name) => name.toLowerCase()));
  const pending: PendingPath[] = [{ path: root, depth: 0 }];
  while (pending.length > 0) {
    const item = pending.pop();
    if (!item) continue;
    if (searchTimedOut(discovery, source, item.path)) return true;
    let stat: Stats;
    try {
      stat = lstatSync(item.path);
    } catch {
      recordSearchSkip(discovery, { source: source.label, path: item.path, reason: 'stat-error' });
      continue;
    }
    if (stat.isSymbolicLink()) {
      skipSymlink(discovery, source, item.path);
      continue;
    }
    if (stat.isDirectory()) {
      if (item.depth > discovery.limits.maxDepth) {
        recordSearchSkip(discovery, { source: source.label, path: item.path, reason: 'max-depth' });
        continue;
      }
      if (discovery.stats.directoriesVisited === discovery.limits.maxDirectories) {
        recordSearchSkip(discovery, {
          source: source.label,
          path: item.path,
          reason: 'max-directories',
        });
        return true;
      }
      discovery.stats.directoriesVisited += 1;
      if (enqueueDirectoryChildren(source, item, discovery, excluded, pending)) return true;
      continue;
    }
    if (!stat.isFile() || seenFiles.has(item.path)) continue;
    if (discovery.stats.filesVisited === discovery.limits.maxFiles) {
      recordSearchSkip(discovery, { source: source.label, path: item.path, reason: 'max-files' });
      return true;
    }
    seenFiles.add(item.path);
    discovery.stats.filesVisited += 1;
    if (!searchableExtensions.has(extname(item.path).toLowerCase())) continue;
    discovery.stats.searchableFiles += 1;
    discovery.candidates.push({ source: source.label, sourceIndex, path: item.path });
  }
  return false;
}

export function scanSearchSources(sources: SearchSource[], discovery: SearchDiscovery): void {
  const seenFiles = new Set<string>();
  for (const [sourceIndex, source] of sources.entries()) {
    if (scanSource(source, sourceIndex, discovery, seenFiles)) break;
  }
}
