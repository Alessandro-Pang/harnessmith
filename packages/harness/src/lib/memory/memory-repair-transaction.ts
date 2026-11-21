import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Io, Runtime } from '../../types.js';
import { calendarDate } from '../filesystem/calendar-date.js';
import { withExclusiveDirectoryLock } from '../filesystem/exclusive-lock.js';
import { atomicWrite } from '../filesystem/files.js';
import { assertSafePath } from '../filesystem/safe-path.js';
import { memoryCoreBudget } from './memory-core-budget.js';
import { withMemoryLock } from './memory-lock.js';
import { memoryMaintenanceReport } from './memory-maintenance.js';
import { readMemoryDocument } from './memory-path.js';
import {
  type ApplyOptions,
  compactCoreContent,
  digest,
  type MemoryRepairReport,
  type RepairProposal,
} from './memory-repair-contract.js';
import {
  cleanupRepairJournal,
  discoverRepairJournals,
  type RepairJournalObservation,
  type RepairMarker,
  repairJournalPaths,
  repairMarkerPath,
  writeRepairMarker,
} from './memory-repair-journal.js';
import { validateMemoryRoot } from './memory-validation.js';
import {
  assertExactFileState,
  type ExactFileState,
  restoreExactFileState,
} from './memory-write.js';

export type { RepairJournalObservation } from './memory-repair-journal.js';
export { discoverRepairJournals } from './memory-repair-journal.js';

function revalidateProposal(proposal: RepairProposal, diagnose: () => MemoryRepairReport): void {
  const current = diagnose().proposals.find(
    (candidate) => candidate.proposalId === proposal.proposalId,
  );
  if (!current || JSON.stringify(current) !== JSON.stringify(proposal)) {
    throw new Error('Repair proposal changed or is no longer applicable');
  }
}

function rollbackCore(
  root: string,
  path: string,
  before: ExactFileState,
  attempted: ExactFileState,
  error: unknown,
  marker: RepairMarker,
): never {
  const rollbackError = restoreExactFileState(root, path, before, attempted);
  if (rollbackError) {
    throw new Error(
      `Core repair failed and rollback was incomplete: ${String(error)}; ${rollbackError}; recovery marker ${repairMarkerPath(marker)}`,
      { cause: error instanceof Error ? error : undefined },
    );
  }
  cleanupRepairJournal(marker);
  throw error;
}

function coreMarker(
  runtime: Runtime,
  proposal: RepairProposal,
  root: string,
  path: string,
  backup: string,
  before: ExactFileState,
  attempted: ExactFileState,
): RepairMarker {
  return {
    version: 1,
    owner: runtime.owner,
    proposalId: proposal.proposalId,
    action: 'compact-core-index',
    stage: 'prepared',
    root,
    target: path,
    backup,
    beforeDigest: digest(before.content),
    afterDigest: digest(attempted.content),
    mode: before.mode,
    createdAt: new Date().toISOString(),
  };
}

export function applyCoreRepairTransaction(
  runtime: Runtime,
  proposal: RepairProposal,
  rootKind: 'global' | 'project',
  io: Io,
  options: ApplyOptions,
  diagnose: () => MemoryRepairReport,
): void {
  const path = proposal.affectedPaths[0];
  if (!path) throw new Error('Core repair requires an affected path');
  const root = dirname(path);
  const journal = repairJournalPaths(runtime, proposal.proposalId);
  withExclusiveDirectoryLock(journal.root, 'Repair journal', () =>
    withMemoryLock(
      root,
      () => {
        options.beforeRevalidate?.();
        revalidateProposal(proposal, diagnose);
        assertSafePath(root, path);
        const entry = lstatSync(path);
        const before = {
          exists: true,
          content: readFileSync(path, 'utf8'),
          mode: entry.mode & 0o777,
        } as const;
        const attempted = {
          exists: true,
          content: compactCoreContent(before.content),
          mode: before.mode,
        } as const;
        const marker = coreMarker(runtime, proposal, root, path, journal.backup, before, attempted);
        if (existsSync(journal.marker) || existsSync(journal.backup)) {
          throw new Error('Repair journal target already exists; diagnose before retrying');
        }
        assertExactFileState(path, before, 'Core repair');
        atomicWrite(journal.backup, before.content, 0o600);
        writeRepairMarker(journal.marker, marker);
        try {
          atomicWrite(path, attempted.content, attempted.mode);
          marker.stage = 'mutated';
          writeRepairMarker(journal.marker, marker);
          validateMemoryRoot(root, io, { quietSuccess: true, rootKind });
          options.beforeVerify?.();
          if (memoryCoreBudget(readMemoryDocument(path)).status !== 'ok') {
            throw new Error('Core repair verifier failed: budget remains over limit');
          }
          if (
            memoryMaintenanceReport(root, calendarDate(runtime), options.projectRelations).unindexed
              .length > 0
          ) {
            throw new Error('Core repair verifier failed: active memory remains unindexed');
          }
          cleanupRepairJournal(marker);
        } catch (error) {
          rollbackCore(root, path, before, attempted, error, marker);
        }
      },
      [],
      { requireExisting: true },
    ),
  );
}

function recoveryFileStates(marker: RepairMarker, expectedTargetDigest: string) {
  const targetEntry = lstatSync(marker.target);
  const backupEntry = lstatSync(marker.backup);
  if (
    !targetEntry.isFile() ||
    targetEntry.isSymbolicLink() ||
    !backupEntry.isFile() ||
    backupEntry.isSymbolicLink()
  ) {
    throw new Error('Interrupted repair files changed; recovery is inconclusive');
  }
  const before = {
    exists: true,
    content: readFileSync(marker.target, 'utf8'),
    mode: targetEntry.mode & 0o777,
  } as const;
  const restored = {
    exists: true,
    content: readFileSync(marker.backup, 'utf8'),
    mode: marker.mode,
  } as const;
  if (before.mode !== marker.mode || digest(before.content) !== expectedTargetDigest) {
    throw new Error('Interrupted repair target changed; recovery is inconclusive');
  }
  if (digest(restored.content) !== marker.beforeDigest) {
    throw new Error('Interrupted repair backup changed; recovery is inconclusive');
  }
  return { before, restored };
}

function restoreInterrupted(
  marker: RepairMarker,
  rootKind: 'global' | 'project',
  io: Io,
  states: { before: ExactFileState; restored: ExactFileState },
): void {
  const { before, restored } = states;
  try {
    atomicWrite(marker.target, restored.content, restored.mode);
    validateMemoryRoot(marker.root, io, { quietSuccess: true, rootKind });
    cleanupRepairJournal(marker);
  } catch (error) {
    const rollbackError = restoreExactFileState(marker.root, marker.target, before, restored);
    if (rollbackError) {
      throw new Error(
        `Repair recovery failed and rollback was incomplete: ${String(error)}; ${rollbackError}`,
      );
    }
    throw error;
  }
}

export function applyJournalRecovery(
  runtime: Runtime,
  observation: RepairJournalObservation,
  proposal: RepairProposal,
  rootKind: 'global' | 'project',
  io: Io,
  options: ApplyOptions,
  diagnose: () => MemoryRepairReport,
): void {
  const marker = observation.markerRecord;
  if (!marker) throw new Error('Repair journal identity is not verified');
  const journal = repairJournalPaths(runtime, marker.proposalId);
  withExclusiveDirectoryLock(journal.root, 'Repair journal', () => {
    withMemoryLock(
      marker.root,
      () => {
        options.beforeRevalidate?.();
        revalidateProposal(proposal, diagnose);
        const current = discoverRepairJournals(runtime, marker.root).find(
          ({ marker: path }) => path === observation.marker,
        );
        if (
          !current ||
          current.status !== observation.status ||
          current.reasonCode !== observation.reasonCode ||
          JSON.stringify(current.markerRecord) !== JSON.stringify(observation.markerRecord)
        ) {
          throw new Error('Repair recovery proposal changed');
        }
        const currentMarker = current.markerRecord;
        if (!currentMarker) throw new Error('Repair journal identity is not verified');
        const states = recoveryFileStates(
          currentMarker,
          current.status === 'orphan-prepared'
            ? currentMarker.beforeDigest
            : currentMarker.afterDigest,
        );
        if (current.status === 'orphan-prepared') cleanupRepairJournal(currentMarker);
        else restoreInterrupted(currentMarker, rootKind, io, states);
      },
      [],
      { requireExisting: true },
    );
  });
}
