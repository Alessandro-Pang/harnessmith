import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { memoryCheck } from '../../commands/memory/memory.js';
import { closeHandoff } from '../../commands/memory/memory-autopilot.js';
import { curateMemory } from '../../commands/memory/memory-curation.js';
import { closeInput } from '../../commands/memory/memory-input-close.js';
import { archiveMemory, supersedeMemory } from '../../commands/memory/memory-lifecycle.js';
import { memoryPromotionProposal } from '../../commands/memory/memory-promotion.js';
import { withExclusiveDirectoryLock } from '../../lib/filesystem/exclusive-lock.js';
import { assertSafePath } from '../../lib/filesystem/safe-path.js';
import {
  boundedCurationSelections,
  type CurationApplyItem,
  type CurationApplySelection,
  curationRecoveryPaths,
  type MemoryCurationApplyReport,
} from '../../lib/memory/memory-curation-contract.js';
import { loadCurationDocuments } from '../../lib/memory/memory-curation-documents.js';
import { readCurationSelectionFile } from '../../lib/memory/memory-curation-selection.js';
import type {
  CurationCommandOptions,
  CurationOptions,
} from '../../lib/memory/memory-curation-types.js';
import { resolveMemoryRoot } from '../../lib/memory/memory-path.js';
import { assertRuntimeCanMutate, calendarDate } from '../../runtime.js';
import type { Io, Runtime } from '../../types.js';

const quietIo: Io = { log() {}, error() {} };

function allProposals(report: ReturnType<typeof curateMemory>) {
  return [
    ...report.promoteCandidates,
    ...report.closeCandidates,
    ...report.supersedeCandidates,
    ...report.archiveCandidates,
  ];
}

function referenceName(reference: string): string {
  return reference.replace(/^memory:/u, '');
}

function applyProposal(
  runtime: Runtime,
  project: string,
  proposal: ReturnType<typeof allProposals>[number],
  selection: CurationApplySelection,
  options: CurationOptions,
  io: Io,
) {
  const memoryRoot = resolveMemoryRoot(runtime, project);
  const document = loadCurationDocuments(memoryRoot).find(
    ({ reference }) => reference === proposal.reference,
  );
  if (!document || document.sourceDigest !== proposal.sourceDigest) {
    throw new Error('Curation proposal source changed; regenerate the proposal');
  }
  const name = referenceName(proposal.reference);
  if (proposal.action === 'close') {
    if (document.kind === 'input') {
      return closeInput(runtime, project, name, { reason: 'workstream-complete' }, io);
    }
    if (document.type === 'session-handoff' && document.session) {
      return closeHandoff(
        runtime,
        project,
        {
          session: document.session,
          outcome: options.outcome === 'user-cancel' ? 'cancelled' : 'completed',
        },
        io,
      );
    }
    throw new Error(`Curation close has no typed lifecycle command for ${proposal.reference}`);
  }
  if (proposal.action === 'archive') {
    return archiveMemory(runtime, project, name, { force: document.status === 'active' }, io);
  }
  if (proposal.action === 'supersede') {
    if (!selection.replacement) {
      throw new Error('Curation supersede selection requires a replacement memory');
    }
    return supersedeMemory(runtime, project, name, referenceName(selection.replacement), io);
  }
  if (!selection.promotion) {
    throw new Error('Curation promote selection requires formal promotion options');
  }
  return memoryPromotionProposal(runtime, project, name, selection.promotion, io);
}

function failedItem(
  selection: CurationApplySelection,
  proposal: ReturnType<typeof allProposals>[number] | undefined,
  error: unknown,
): CurationApplyItem {
  return {
    proposalId: selection.proposalId,
    action: proposal?.action ?? 'unknown',
    reference: proposal?.reference ?? null,
    validation: {
      status: 'failed',
      command: proposal?.verifier.command ?? 'regenerate curation report',
      exitCode: 1,
    },
    reason: error instanceof Error ? error.message : String(error),
    recoveryPaths: curationRecoveryPaths(error),
  };
}

function passedItem(
  proposal: ReturnType<typeof allProposals>[number],
  result: unknown,
): CurationApplyItem {
  const normalizedResult =
    proposal.action === 'promote'
      ? (result as CurationApplyItem['result'])
      : typeof result === 'string'
        ? { path: result }
        : result && typeof result === 'object' && 'path' in result
          ? { path: String((result as { path: unknown }).path) }
          : undefined;
  return {
    proposalId: proposal.proposalId,
    action: proposal.action,
    reference: proposal.reference,
    validation: { status: 'passed', command: proposal.verifier.command, exitCode: 0 },
    reason:
      proposal.action === 'promote'
        ? 'formal promotion proposal generated; authoritative write remains separate'
        : 'typed lifecycle command and independent memory verifier passed',
    recoveryPaths: [],
    ...(normalizedResult ? { result: normalizedResult } : {}),
  };
}

export function curationApplyLockRoot(runtime: Runtime, project: string): string {
  const identity = createHash('sha256').update(project).digest('hex').slice(0, 24);
  const root = join(runtime.installedHarness, 'state', 'curation', identity);
  assertSafePath(runtime.installedHarness, root);
  return root;
}

export function applyMemoryCuration(
  runtime: Runtime,
  project: string,
  options: CurationOptions,
  requested: CurationApplySelection[],
  io: Io = console,
): MemoryCurationApplyReport {
  assertRuntimeCanMutate(runtime);
  const selections = boundedCurationSelections(requested);
  return withExclusiveDirectoryLock(
    curationApplyLockRoot(runtime, project),
    'Memory curation apply',
    () => {
      const items: CurationApplyItem[] = [];
      for (const selection of selections) {
        let current: ReturnType<typeof curateMemory>;
        try {
          current = curateMemory(runtime, project, options, quietIo);
        } catch (error) {
          items.push(
            failedItem(
              selection,
              undefined,
              new Error(
                `Curation proposal is stale, changed, or invalid; regenerate it: ${String(error)}`,
                { cause: error instanceof Error ? error : undefined },
              ),
            ),
          );
          continue;
        }
        const proposal = allProposals(current).find(
          ({ proposalId }) => proposalId === selection.proposalId,
        );
        if (!proposal || proposal.expiresOn !== calendarDate(runtime)) {
          items.push(
            failedItem(
              selection,
              proposal,
              new Error('Curation proposal is stale, changed, or expired; regenerate it'),
            ),
          );
          continue;
        }
        try {
          const result = applyProposal(runtime, project, proposal, selection, options, quietIo);
          memoryCheck(runtime, project, quietIo, { indexed: true, json: false });
          items.push(passedItem(proposal, result));
        } catch (error) {
          items.push(failedItem(selection, proposal, error));
        }
      }
      let remaining: ReturnType<typeof allProposals> = [];
      let remainingValidation: MemoryCurationApplyReport['remainingValidation'] = {
        status: 'passed',
        reason: 'remaining proposals regenerated from current validated state',
      };
      try {
        remaining = allProposals(curateMemory(runtime, project, options, quietIo));
      } catch (error) {
        remainingValidation = {
          status: 'inconclusive',
          reason: `remaining proposals could not be regenerated: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
      const passed = items.filter(({ validation }) => validation.status === 'passed').length;
      const status = passed === items.length ? 'passed' : passed === 0 ? 'failed' : 'partial';
      const report: MemoryCurationApplyReport = {
        version: 1,
        mode: 'applied',
        project,
        task: options.task,
        status,
        items,
        remainingProposals: remaining,
        remainingValidation,
      };
      io.log(JSON.stringify(report, null, 2));
      return report;
    },
  );
}

export function memoryCuration(
  runtime: Runtime,
  project: string,
  options: CurationCommandOptions,
  io: Io = console,
) {
  const applying = options.apply !== undefined || options.applyFile !== undefined;
  if (!applying) {
    if (options.yes) throw new Error('Curation --yes requires --apply or --apply-file');
    return curateMemory(runtime, project, options, io);
  }
  if (!options.yes) throw new Error('Curation apply requires explicit --yes confirmation');
  if (options.apply !== undefined && options.applyFile !== undefined) {
    throw new Error('Curation --apply cannot be combined with --apply-file');
  }
  const selections = options.applyFile
    ? readCurationSelectionFile(options.applyFile)
    : (options.apply ?? []).map((proposalId) => ({ proposalId }));
  return applyMemoryCuration(runtime, project, options, selections, io);
}
