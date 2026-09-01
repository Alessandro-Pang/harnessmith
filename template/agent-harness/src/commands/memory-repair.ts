import { applyMemoryRepair } from '../lib/memory-repair-apply.js';
import { diagnoseMemoryRepair } from '../lib/memory-repair-plan.js';
import type { Io, Runtime } from '../types.js';

export { applyMemoryRepair, diagnoseMemoryRepair };

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
