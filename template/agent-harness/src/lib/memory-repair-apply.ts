import { assertRuntimeCanMutate, calendarDate } from '../runtime.js';
import type { Io, Runtime } from '../types.js';
import { withGlobalMemoryTransaction } from './global-memory.js';
import { memoryMaintenanceReport } from './memory-maintenance.js';
import { type ApplyOptions, memorySources, repairContext } from './memory-repair-contract.js';
import { diagnoseMemoryRepair } from './memory-repair-plan.js';
import {
  applyCoreRepairTransaction,
  applyJournalRecovery,
  discoverRepairJournals,
} from './memory-repair-transaction.js';
import { validateMemoryRoot } from './memory-validation.js';

function verifyIndexedMemory(
  runtime: Runtime,
  root: string,
  rootKind: 'global' | 'project',
  io: Io,
): void {
  validateMemoryRoot(root, io, { quietSuccess: true, rootKind });
  const maintenance = memoryMaintenanceReport(root, calendarDate(runtime));
  if (maintenance.unindexed.length > 0) {
    throw new Error(`Repair verifier found ${maintenance.unindexed.length} unindexed memories`);
  }
}

import { withProjectMemoryTransaction } from './project-memory.js';
import { loadCurrentIndex, refreshSearchIndex } from './search-index-store.js';

export function applyMemoryRepair(
  runtime: Runtime,
  scope: string,
  proposalId: string,
  io: Io = console,
  options: ApplyOptions = {},
) {
  assertRuntimeCanMutate(runtime);
  const report = diagnoseMemoryRepair(runtime, scope, io);
  const selected = report.proposals.find((candidate) => candidate.proposalId === proposalId);
  if (!selected) throw new Error('Repair proposal changed or is no longer applicable');
  const { rootKind } = repairContext(runtime, scope);
  if (selected.action === 'initialize-missing-memory') {
    const verify = () => {
      options.beforeVerify?.();
      verifyIndexedMemory(runtime, report.root, rootKind, io);
    };
    if (rootKind === 'global') withGlobalMemoryTransaction(runtime, verify);
    else withProjectMemoryTransaction(runtime, scope, verify);
  } else if (selected.action === 'rebuild-derived-index') {
    const sources = memorySources(report.root);
    refreshSearchIndex(runtime, sources, {});
    options.beforeVerify?.();
    loadCurrentIndex(runtime, sources, {});
  } else if (selected.action === 'compact-core-index') {
    applyCoreRepairTransaction(runtime, selected, rootKind, io, options);
  } else {
    const markerPath = selected.affectedPaths.find((path) => path.endsWith('.json'));
    const journal = discoverRepairJournals(runtime, report.root).find(
      ({ marker }) => marker === markerPath,
    );
    if (!journal) throw new Error('Repair recovery proposal changed');
    applyJournalRecovery(runtime, journal, rootKind, io);
  }
  return {
    version: 1 as const,
    mode: 'applied' as const,
    proposalId,
    action: selected.action,
    affectedPaths: selected.affectedPaths,
    verification: { status: 'passed' as const, command: selected.verifier.command, exitCode: 0 },
    recovery: selected.backup,
  };
}
