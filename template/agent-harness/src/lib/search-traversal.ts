import { type Dirent, existsSync, lstatSync, opendirSync, type Stats } from 'node:fs';
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

function scanSource(
  source: SearchSource,
  sourceIndex: number,
  discovery: SearchDiscovery,
  seenFiles: Set<string>,
): boolean {
  if (!existsSync(source.root)) return false;
  const excluded = new Set(source.excludeDirectories || []);
  const pending: PendingPath[] = [{ path: source.root, depth: 0 }];
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
      const scanned = directoryEntries(source, item, discovery);
      if (!scanned) continue;
      for (const entry of scanned.entries.sort((left, right) =>
        right.name.localeCompare(left.name),
      )) {
        if (entry.isDirectory() && excluded.has(entry.name)) continue;
        pending.push({ path: join(item.path, entry.name), depth: item.depth + 1 });
      }
      if (scanned.exhausted) return true;
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
