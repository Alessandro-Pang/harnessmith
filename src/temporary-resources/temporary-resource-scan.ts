import { existsSync, lstatSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  canonicalTemporaryDirectory,
  readTemporaryResourceMarker,
  type TemporaryResourceLifecycle,
  temporaryResourceMarkerName,
} from './temporary-resource-marker.js';
import { errorMessage } from '../shared/types.js';

const lockTargetName = /^[0-9a-f]{64}$/;
const defaultEntryLimit = 10_000;
const defaultByteLimit = 64 * 1024 * 1024;
const defaultResultLimit = 50;

export interface TemporaryResourceReportItem {
  kind: 'workspace' | 'lock-target';
  path: string;
  owner: string;
  purpose: string;
  lifecycle: TemporaryResourceLifecycle;
  createdAt: string;
  ageMilliseconds: number;
  active: boolean;
  sizeBytes: number;
  sizeTruncated: boolean;
}

export interface TemporaryResourceScanReport {
  version: 1;
  action: 'dry-run';
  root: string;
  scannedEntries: number;
  truncated: boolean;
  resources: TemporaryResourceReportItem[];
  skipped: Array<{ path: string; reason: string }>;
}

interface ScanBudget {
  entries: number;
  results: number;
  truncated: boolean;
}

function processIsActive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

function directorySize(
  root: string,
  entryLimit: number,
  byteLimit: number,
): { bytes: number; truncated: boolean } {
  const pending = [root];
  let entries = 0;
  let bytes = 0;
  while (pending.length > 0) {
    const current = pending.pop() as string;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      entries += 1;
      if (entries > entryLimit) return { bytes, truncated: true };
      const path = join(current, entry.name);
      const stat = lstatSync(path);
      bytes += stat.size;
      if (bytes > byteLimit) return { bytes: byteLimit, truncated: true };
      if (entry.isDirectory() && !entry.isSymbolicLink()) pending.push(path);
    }
  }
  return { bytes, truncated: false };
}

function consumeEntry(budget: ScanBudget): boolean {
  if (budget.entries <= 0) {
    budget.truncated = true;
    return false;
  }
  budget.entries -= 1;
  return true;
}

function addResource(
  resources: TemporaryResourceReportItem[],
  resource: TemporaryResourceReportItem,
  budget: ScanBudget,
): boolean {
  if (budget.results <= 0) {
    budget.truncated = true;
    return false;
  }
  resources.push(resource);
  budget.results -= 1;
  return true;
}

function scanLockNamespace(
  path: string,
  now: number,
  sizeLimits: { entries: number; bytes: number },
  budget: ScanBudget,
  resources: TemporaryResourceReportItem[],
): void {
  const children = readdirSync(path, { withFileTypes: true });
  const childNames = new Set(children.map(({ name }) => name));
  for (const child of children.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!consumeEntry(budget)) return;
    if (!child.isDirectory() || child.isSymbolicLink() || !lockTargetName.test(child.name)) {
      continue;
    }
    const target = join(path, child.name);
    const stat = statSync(target);
    const size = directorySize(target, sizeLimits.entries, sizeLimits.bytes);
    const active =
      childNames.has(`${child.name}.lock`) ||
      [...childNames].some((name) => name.startsWith(`${child.name}.handoff-`));
    const added = addResource(
      resources,
      {
        kind: 'lock-target',
        path: target,
        owner: 'user-data-coordination',
        purpose: 'user-data-lock',
        lifecycle: 'process',
        createdAt: stat.birthtime.toISOString(),
        ageMilliseconds: Math.max(0, now - stat.birthtimeMs),
        active,
        sizeBytes: size.bytes,
        sizeTruncated: size.truncated,
      },
      budget,
    );
    if (!added) return;
  }
}

function workspaceResource(
  path: string,
  now: number,
  sizeLimits: { entries: number; bytes: number },
): TemporaryResourceReportItem {
  const marker = readTemporaryResourceMarker(join(path, temporaryResourceMarkerName));
  const size = directorySize(path, sizeLimits.entries, sizeLimits.bytes);
  return {
    kind: 'workspace',
    path,
    owner: marker.owner,
    purpose: marker.purpose,
    lifecycle: marker.lifecycle,
    createdAt: marker.createdAt,
    ageMilliseconds: Math.max(0, now - Date.parse(marker.createdAt)),
    active: processIsActive(marker.pid),
    sizeBytes: size.bytes,
    sizeTruncated: size.truncated,
  };
}

export function scanTemporaryResources(
  options: {
    root?: string;
    now?: number;
    maxEntries?: number;
    maxBytesPerResource?: number;
    maxResults?: number;
  } = {},
): TemporaryResourceScanReport {
  const root = canonicalTemporaryDirectory(options.root ?? tmpdir());
  const now = options.now ?? Date.now();
  const maximumEntries = options.maxEntries ?? defaultEntryLimit;
  const sizeLimits = {
    entries: maximumEntries,
    bytes: options.maxBytesPerResource ?? defaultByteLimit,
  };
  const budget: ScanBudget = {
    entries: maximumEntries,
    results: options.maxResults ?? defaultResultLimit,
    truncated: false,
  };
  const resources: TemporaryResourceReportItem[] = [];
  const skipped: Array<{ path: string; reason: string }> = [];
  const entries = readdirSync(root, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  for (const entry of entries) {
    if (!consumeEntry(budget)) break;
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const path = join(root, entry.name);
    if (entry.name.startsWith('harnessmith-user-data-locks-')) {
      scanLockNamespace(path, now, sizeLimits, budget, resources);
      if (budget.truncated) break;
      continue;
    }
    const marker = join(path, temporaryResourceMarkerName);
    if (!entry.name.startsWith('harnessmith-') || !existsSync(marker)) continue;
    try {
      if (!addResource(resources, workspaceResource(path, now, sizeLimits), budget)) break;
    } catch (error) {
      skipped.push({ path, reason: errorMessage(error) });
    }
  }
  return {
    version: 1,
    action: 'dry-run',
    root,
    scannedEntries: maximumEntries - budget.entries,
    truncated: budget.truncated,
    resources,
    skipped,
  };
}
