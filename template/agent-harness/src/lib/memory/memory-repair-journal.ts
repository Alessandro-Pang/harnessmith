import { existsSync, lstatSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Runtime } from '../../types.js';
import { atomicWrite } from '../filesystem/files.js';
import { digest } from './memory-repair-contract.js';
import { assertSafePath } from '../filesystem/safe-path.js';

export interface RepairMarker {
  version: 1;
  owner: string;
  proposalId: string;
  action: 'compact-core-index';
  stage: 'prepared' | 'mutated';
  root: string;
  target: string;
  backup: string;
  beforeDigest: string;
  afterDigest: string;
  mode: number;
  createdAt: string;
}

export interface RepairJournalObservation {
  marker: string;
  backup: string;
  status: 'orphan-prepared' | 'interrupted-mutation' | 'inconclusive';
  reasonCode: string;
  markerRecord?: RepairMarker;
}

function validProposalId(value: string): boolean {
  return /^sha256:[0-9a-f]{64}$/.test(value);
}

export function repairJournalPaths(runtime: Runtime, proposalId: string) {
  if (!validProposalId(proposalId)) throw new Error('Invalid repair proposal id');
  const root = join(runtime.installedHarness, 'state', 'repair');
  const identity = proposalId.slice('sha256:'.length);
  const marker = join(root, `${identity}.json`);
  const backup = join(root, `${identity}.backup`);
  for (const path of [root, marker, backup]) assertSafePath(runtime.installedHarness, path);
  return { root, marker, backup };
}

export function repairMarkerPath(marker: RepairMarker): string {
  return join(marker.backup, '..', `${marker.proposalId.slice(7)}.json`);
}

function readRepairMarker(path: string): RepairMarker | null {
  try {
    const entry = lstatSync(path);
    if (!entry.isFile() || entry.isSymbolicLink() || entry.size > 64 * 1024) return null;
    const value = JSON.parse(readFileSync(path, 'utf8')) as Partial<RepairMarker>;
    if (
      value.version !== 1 ||
      value.action !== 'compact-core-index' ||
      !['prepared', 'mutated'].includes(value.stage || '') ||
      typeof value.owner !== 'string' ||
      typeof value.proposalId !== 'string' ||
      !validProposalId(value.proposalId) ||
      typeof value.root !== 'string' ||
      typeof value.target !== 'string' ||
      typeof value.backup !== 'string' ||
      !/^[0-9a-f]{64}$/.test(value.beforeDigest || '') ||
      !/^[0-9a-f]{64}$/.test(value.afterDigest || '') ||
      !Number.isInteger(value.mode)
    ) {
      return null;
    }
    return value as RepairMarker;
  } catch {
    return null;
  }
}

function regularRepairFileDigest(path: string): string | null {
  try {
    const entry = lstatSync(path);
    if (!entry.isFile() || entry.isSymbolicLink() || entry.size > 2 * 1024 * 1024) return null;
    return digest(readFileSync(path));
  } catch {
    return null;
  }
}

function observeMarker(runtime: Runtime, root: string, markerPath: string) {
  const marker = readRepairMarker(markerPath);
  if (!marker || marker.owner !== runtime.owner || marker.root !== root) {
    return {
      marker: markerPath,
      backup: marker?.backup || markerPath,
      status: 'inconclusive' as const,
      reasonCode: 'REPAIR_MARKER_IDENTITY_UNVERIFIED',
    };
  }
  const paths = repairJournalPaths(runtime, marker.proposalId);
  const pathsValid =
    paths.marker === markerPath &&
    paths.backup === marker.backup &&
    marker.target === join(root, 'core.md');
  if (!pathsValid) {
    return {
      marker: markerPath,
      backup: marker.backup,
      status: 'inconclusive' as const,
      reasonCode: 'REPAIR_MARKER_CONTENT_UNVERIFIED',
      markerRecord: marker,
    };
  }
  const targetDigest = regularRepairFileDigest(marker.target);
  const backupDigest = regularRepairFileDigest(marker.backup);
  if (backupDigest !== marker.beforeDigest) {
    return {
      marker: markerPath,
      backup: marker.backup,
      status: 'inconclusive' as const,
      reasonCode: 'REPAIR_MARKER_CONTENT_UNVERIFIED',
      markerRecord: marker,
    };
  }
  if (marker.stage === 'prepared' && targetDigest === marker.beforeDigest) {
    return {
      marker: markerPath,
      backup: marker.backup,
      status: 'orphan-prepared' as const,
      reasonCode: 'PREPARED_REPAIR_NOT_MUTATED',
      markerRecord: marker,
    };
  }
  if (marker.stage === 'mutated' && targetDigest === marker.afterDigest) {
    return {
      marker: markerPath,
      backup: marker.backup,
      status: 'interrupted-mutation' as const,
      reasonCode: 'MUTATED_REPAIR_NOT_FINALIZED',
      markerRecord: marker,
    };
  }
  return {
    marker: markerPath,
    backup: marker.backup,
    status: 'inconclusive' as const,
    reasonCode: 'REPAIR_TARGET_CHANGED',
    markerRecord: marker,
  };
}

export function discoverRepairJournals(runtime: Runtime, root: string): RepairJournalObservation[] {
  const journalRoot = join(runtime.installedHarness, 'state', 'repair');
  if (!existsSync(journalRoot)) return [];
  assertSafePath(runtime.installedHarness, journalRoot);
  const names = readdirSync(journalRoot).sort();
  if (names.length > 256) {
    return [
      {
        marker: journalRoot,
        backup: journalRoot,
        status: 'inconclusive',
        reasonCode: 'REPAIR_JOURNAL_ENTRY_BUDGET_EXCEEDED',
      },
    ];
  }
  const markers = names
    .filter((name) => name.endsWith('.json'))
    .map((name) => observeMarker(runtime, root, join(journalRoot, name)));
  const orphanBackups = names
    .filter(
      (name) =>
        /^[0-9a-f]{64}\.backup$/.test(name) &&
        !names.includes(`${name.slice(0, -'.backup'.length)}.json`),
    )
    .map((name) => ({
      marker: join(journalRoot, name),
      backup: join(journalRoot, name),
      status: 'inconclusive' as const,
      reasonCode: 'OWNERLESS_REPAIR_BACKUP_RETAINED',
    }));
  return [...markers, ...orphanBackups];
}

export function writeRepairMarker(path: string, marker: RepairMarker): void {
  atomicWrite(path, `${JSON.stringify(marker, null, 2)}\n`, 0o600);
}

export function cleanupRepairJournal(marker: RepairMarker): void {
  if (regularRepairFileDigest(marker.backup) !== marker.beforeDigest) {
    throw new Error(`Repair backup changed; retained at recovery path ${marker.backup}`);
  }
  const current = readRepairMarker(repairMarkerPath(marker));
  if (!current || JSON.stringify(current) !== JSON.stringify(marker)) {
    throw new Error('Repair marker changed; retained for inspection');
  }
  rmSync(marker.backup);
  rmSync(repairMarkerPath(marker));
}
