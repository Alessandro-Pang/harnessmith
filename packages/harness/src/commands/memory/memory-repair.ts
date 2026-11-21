import { applyMemoryRepair as applyMemoryRepairCore } from '../../lib/memory/memory-repair-apply.js';
import type { ApplyOptions } from '../../lib/memory/memory-repair-contract.js';
import { diagnoseMemoryRepair } from '../../lib/memory/memory-repair-plan.js';
import { withProjectMemoryTransaction } from '../../lib/project/project-memory.js';
import { workflowRelationsForProject } from '../../lib/workflow/workflow-relations.js';
import type { Io, Runtime } from '../../types.js';

export { diagnoseMemoryRepair };

/**
 * Thin composition: the memory repair core stays free of project/workflow I/O
 * imports. The command layer injects the project transaction runner and the
 * project relations reader so repair verification keeps the full maintenance
 * report and the applied result stays unchanged.
 */
export function applyMemoryRepair(
  runtime: Runtime,
  scope: string,
  proposalId: string,
  io: Io = console,
  options: ApplyOptions = {},
) {
  return applyMemoryRepairCore(runtime, scope, proposalId, io, {
    ...options,
    projectRelations: options.projectRelations ?? workflowRelationsForProject,
    withProjectTransaction: options.withProjectTransaction ?? withProjectMemoryTransaction,
  });
}

export function memoryRepair(
  runtime: Runtime,
  scope: string,
  options: { proposal?: string; yes?: boolean; json?: boolean },
  io: Io = console,
) {
  if ((options.proposal && !options.yes) || (options.yes && !options.proposal)) {
    throw new Error('Repair apply requires both --proposal <id> and --yes');
  }
  const result =
    options.proposal && options.yes
      ? applyMemoryRepair(runtime, scope, options.proposal, io)
      : diagnoseMemoryRepair(runtime, scope, io);
  if (options.json) io.log(JSON.stringify(result, null, 2));
  else if ('proposals' in result) {
    for (const candidate of result.proposals) {
      io.log(`${candidate.action} ${candidate.proposalId}`);
      for (const path of candidate.affectedPaths) io.log(`  target ${path}`);
      io.log(`  verifier ${candidate.verifier.command}`);
    }
  } else io.log(`${result.action}: ${result.verification.status}`);
  return result;
}
