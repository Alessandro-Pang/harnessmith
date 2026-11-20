import {
  compactionHandoffVerificationIsCurrent,
  textContainsExactVerifierCommand,
} from '../eval-codex-support.mjs';

/**
 * @param {import('./assertion-types.mjs').AssertionContext} context
 * @param {ReturnType<typeof import('./autopilot-input-profile.mjs').buildAutopilotInputProfile> & ReturnType<typeof import('./autopilot-handoff-commands.mjs').buildAutopilotHandoffCommands>} state
 */
export function buildAutopilotCompaction(context, state) {
  const { section, turnByLabel } = context;
  const {
    pre,
    initialVerification,
    preVerification,
    initialTurn,
    preTurn,
    preInvocation,
    handoffCommandIsExact,
    initialVerifier,
  } = state;
  const compactionSignalTurn = turnByLabel.get('pre-compaction-signal');
  const evaluatorCompactionSignal = Boolean(
    compactionSignalTurn?.kind === 'host-signal' &&
      compactionSignalTurn.completion.completed === true &&
      /context_budget_remaining=8%/.test(compactionSignalTurn.prompt),
  );
  const preObservation = turnByLabel.get('pre-compaction-signal')?.observation;
  const preReferenceCount = pre
    ? (preObservation?.projectCore?.match(
        new RegExp(pre.reference.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
      )?.length ?? 0)
    : 0;
  const preCompleted = section(pre?.content, '已完成');
  const preNext = section(pre?.content, '下一步');
  const preNextVerifierProven = textContainsExactVerifierCommand(preNext, {
    script: 'verify-autopilot.mjs',
    target: 'apps/docs/site/follow-up.txt',
  });
  const preVerificationProven = Boolean(
    handoffCommandIsExact(preInvocation) &&
      preInvocation?.payload?.ok === true &&
      preInvocation.payload.value?.reason === 'compaction' &&
      compactionHandoffVerificationIsCurrent({
        payloadValue: preInvocation.payload.value,
        persistedVerification: preVerification,
        previousVerification: initialVerification,
        expectedVerifier: initialVerifier,
        previousProjectTree: initialTurn?.observation.trees.project,
        currentProjectTree: preTurn?.observation.trees.project,
      }),
  );
  return {
    evaluatorCompactionSignal,
    preReferenceCount,
    preCompleted,
    preNext,
    preNextVerifierProven,
    preVerificationProven,
  };
}
