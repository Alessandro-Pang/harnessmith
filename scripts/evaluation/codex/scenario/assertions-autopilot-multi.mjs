import { multiTaskCheckpointReplacementIsProven } from '../eval-codex-support.mjs';
import { buildAutopilotMultiEvidence } from './autopilot-multi-evidence.mjs';

/**
 * @param {import('./assertion-types.mjs').AssertionContext} context
 * @param {import('./assertion-types.mjs').SetAssertions} setAssertions
 */
export function evaluateAutopilotMultiTask(context, setAssertions) {
  if (context.scenarioId !== 'memory-autopilot-multi-task') return;
  const evidence = buildAutopilotMultiEvidence(context);
  const { final, core, completed, states } = evidence;
  setAssertions(
    [
      multiTaskCheckpointReplacementIsProven({
        afterSecond: evidence.afterB,
        afterThird: evidence.afterC,
        allVerifiersPassed: context.verifiersPassed('initial', 'item-b', 'item-c'),
      }),
      Boolean(
        evidence.structuredSnapshot &&
          evidence.concreteNext &&
          ['item-a.txt', 'item-b.txt', 'item-c.txt'].every((path) => completed.includes(path)),
      ),
      Boolean(
        final &&
          evidence.finalActiveIndexInvariant &&
          !evidence.containsRawTranscript &&
          (core.match(new RegExp(final.reference.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))
            ?.length ?? 0) === 1,
      ),
    ],
    [
      !context.turnPlan.some(({ prompt }) => /context_budget_remaining|compact/i.test(prompt)),
      context.sessionSnapshots('multi-thread-23').length <= 1,
      !context.asksRoutineMemoryPermission && !evidence.hasPersistenceRequest && Boolean(final),
      context.memoryAutopilotBoundaryOk,
    ],
    [
      `active-index-states=${JSON.stringify(states)}; structured=${evidence.structuredSnapshot}; raw-transcript=${evidence.containsRawTranscript}`,
    ],
  );
}
