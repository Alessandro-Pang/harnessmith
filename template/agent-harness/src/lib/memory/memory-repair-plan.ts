import { existsSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import type { Io, Runtime } from '../../types.js';
import { memoryCoreBudget } from './memory-core-budget.js';
import { readMemoryDocument } from './memory-path.js';
import {
  compactCoreContent,
  digest,
  fileIdentity,
  type MemoryRepairReport,
  memorySources,
  type RepairProposal,
  repairContext,
  repairProposal,
  validationDiagnostics,
} from './memory-repair-contract.js';
import {
  discoverRepairJournals,
  type RepairJournalObservation,
} from './memory-repair-transaction.js';
import { assertSafePath } from '../filesystem/safe-path.js';
import { searchIndexPath } from '../search/search-index.js';
import { loadCurrentIndex } from '../search/search-index-store.js';

function initializationProposal(
  runtime: Runtime,
  scope: string,
  required: string[],
): RepairProposal | null {
  const missing = required.filter((path) => !existsSync(path));
  if (missing.length === 0) return null;
  return repairProposal(
    'initialize-missing-memory',
    {
      authority: 'managed-memory-template',
      affectedPaths: missing,
      backup: {
        required: false,
        strategy: 'create-missing-only-with-transaction-rollback',
        recoveryPaths: missing,
      },
      prerequisites: ['runtime-identity-valid', 'memory-lock-available'],
      risk: 'low',
      verifier: {
        command: `harness memory check ${scope} --indexed --json`,
        owner: 'harness',
        expected: 'exit 0',
      },
      diagnosis: { status: 'failed', reasonCode: 'PARTIAL_INITIALIZATION' },
    },
    { owner: runtime.owner, paths: required.map((path) => [path, fileIdentity(path)]) },
  );
}

function coreProposal(root: string, scope: string): RepairProposal | null {
  const core = join(root, 'core.md');
  if (!existsSync(core)) return null;
  assertSafePath(root, core);
  const content = readMemoryDocument(core);
  const budget = memoryCoreBudget(content);
  const candidate = compactCoreContent(content);
  if (
    budget.status === 'ok' ||
    candidate === content ||
    memoryCoreBudget(candidate).status !== 'ok'
  ) {
    return null;
  }
  return repairProposal(
    'compact-core-index',
    {
      authority: 'managed-core-index',
      affectedPaths: [core],
      backup: {
        required: true,
        strategy: 'exact-byte-and-mode-transaction-snapshot',
        recoveryPaths: [core],
      },
      prerequisites: ['runtime-identity-valid', 'memory-lock-available', 'candidate-valid'],
      risk: 'medium',
      verifier: {
        command: `harness memory check ${scope} --indexed --json`,
        owner: 'harness',
        expected: 'exit 0 and core budget ok',
      },
      diagnosis: { status: 'failed', reasonCode: `CORE_${budget.status.toUpperCase()}` },
    },
    { contentDigest: digest(content), mode: lstatSync(core).mode & 0o777 },
  );
}

function indexProposal(runtime: Runtime, root: string, scope: string): RepairProposal | null {
  const sources = memorySources(root);
  const index = searchIndexPath(runtime, sources);
  let status = 'ready';
  try {
    loadCurrentIndex(runtime, sources, {});
  } catch (error) {
    status =
      error && typeof error === 'object' && 'status' in error
        ? String((error as { status: unknown }).status)
        : 'corrupt';
  }
  if (status === 'ready') return null;
  return repairProposal(
    'rebuild-derived-index',
    {
      authority: 'derived-search-cache',
      affectedPaths: [index],
      backup: {
        required: false,
        strategy: 'derived-cache-atomic-replacement',
        recoveryPaths: [],
      },
      prerequisites: ['runtime-identity-valid', 'search-index-lock-available'],
      risk: 'low',
      verifier: {
        command: `harness memory search ${scope} __repair_probe__ --mode fulltext --json`,
        owner: 'harness',
        expected: 'index loads without fallback',
      },
      diagnosis: { status: 'failed', reasonCode: `DERIVED_INDEX_${status.toUpperCase()}` },
    },
    { index: fileIdentity(index), root: fileIdentity(root) },
  );
}

function journalProposal(observation: RepairJournalObservation): RepairProposal | null {
  if (observation.status === 'inconclusive') return null;
  const restoring = observation.status === 'interrupted-mutation';
  return repairProposal(
    restoring ? 'restore-interrupted-core-repair' : 'clear-orphan-repair-marker',
    {
      authority: 'verified-repair-transaction-marker',
      affectedPaths: restoring
        ? [observation.markerRecord?.target || '', observation.marker, observation.backup]
        : [observation.marker, observation.backup],
      backup: {
        required: restoring,
        strategy: restoring ? 'verified-journal-byte-backup' : 'verified-unmutated-target',
        recoveryPaths: restoring ? [observation.backup] : [],
      },
      prerequisites: ['runtime-owner-match', 'repair-journal-lock-available', 'digest-match'],
      risk: restoring ? 'medium' : 'low',
      verifier: {
        command: 'harness memory check <scope> --indexed --json',
        owner: 'harness',
        expected: restoring ? 'exit 0 and original bytes restored' : 'marker and backup absent',
      },
      diagnosis: { status: 'failed', reasonCode: observation.reasonCode },
    },
    {
      marker: fileIdentity(observation.marker),
      backup: fileIdentity(observation.backup),
      target: observation.markerRecord ? fileIdentity(observation.markerRecord.target) : null,
    },
  );
}

export function diagnoseMemoryRepair(
  runtime: Runtime,
  scope = '.',
  io: Io = console,
): MemoryRepairReport {
  const { root, rootKind, required } = repairContext(runtime, scope);
  const journals = discoverRepairJournals(runtime, root);
  const proposals = [
    ...journals.map(journalProposal),
    initializationProposal(runtime, scope, required),
    coreProposal(root, scope),
    indexProposal(runtime, root, scope),
  ].filter((candidate): candidate is RepairProposal => candidate !== null);
  const unresolved: MemoryRepairReport['unresolved'] = [];
  for (const journal of journals.filter(({ status }) => status === 'inconclusive')) {
    unresolved.push({
      fault: 'repair-transaction',
      status: 'inconclusive',
      reasonCode: journal.reasonCode,
      diagnostics: [journal.marker],
    });
  }
  if (required.every(existsSync) && existsSync(root)) {
    const validation = validationDiagnostics(root, rootKind, io);
    if (!validation.valid) {
      unresolved.push({
        fault: 'memory-validation',
        status: 'inconclusive',
        reasonCode: 'NO_TYPED_AUTOMATIC_REPAIR',
        diagnostics: validation.diagnostics,
      });
    }
  }
  return {
    version: 1,
    mode: 'diagnose-only',
    scope,
    root,
    mutation: { status: 'unchanged', reasonCode: 'diagnose-only' },
    proposals,
    unresolved,
  };
}
