/**
 * @param {import('./assertion-types.mjs').AssertionContext} context
 * @param {import('./autopilot-evidence-types.mjs').AutopilotEvidence} state
 */
export function autopilotCompactionPasses(context, state) {
  const { verifiersPassed } = context;
  const {
    typedInputCaptureProven,
    exactInputIndexed,
    explicitProfileReconcileProven,
    explicitOneSentencePreference,
    evaluatorCompactionSignal,
    pre,
    preReferenceCount,
    preVerificationProven,
    preCompleted,
    preNext,
    preNextVerifierProven,
    follow,
    omittedDecisionsPreserved,
    followOpenReconciliationProven,
    repeated,
    idempotencyProven,
  } = state;
  return [
    typedInputCaptureProven && exactInputIndexed && verifiersPassed('initial'),
    explicitProfileReconcileProven && explicitOneSentencePreference,
    evaluatorCompactionSignal &&
      null &&
      pre?.reason === 'compaction' &&
      preReferenceCount === 1 &&
      verifiersPassed('initial') &&
      preVerificationProven &&
      /docs\/status\.txt/i.test(preCompleted) &&
      /ready|verif(?:y|ied)|pass(?:ed)?|通过|验证/i.test(preCompleted) &&
      /follow-up\.txt/.test(preNext) &&
      preNextVerifierProven,
    Boolean(
      pre &&
        follow &&
        pre.path === follow.path &&
        pre.digest !== follow.digest &&
        omittedDecisionsPreserved,
    ),
    Boolean(follow && verifiersPassed('follow-up-edit') && followOpenReconciliationProven),
    Boolean(follow && repeated && follow.digest === repeated.digest && idempotencyProven),
  ];
}

/**
 * @param {import('./autopilot-evidence-types.mjs').AutopilotEvidence} state
 */
export function autopilotProfilePasses(state) {
  const {
    core,
    pause,
    forgot,
    repeated,
    closed,
    profileKeyLinePattern,
    pauseEntriesUnchanged,
    pausedPreferenceStayedEphemeral,
    forgetEntryMutationExact,
    explicitPausedUpdateProven,
    explicitPausedUpdateAvoidedAutopilotToggle,
    profileControlStatesValid,
    pauseUsedMachineReadableControl,
    forgetUsedReconciledKey,
    closeTimingProven,
    closedSnapshots,
  } = state;
  return [
    Boolean(
      pause?.profile?.includes('profile-autopilot: paused') &&
        profileKeyLinePattern.test(pause.profile) &&
        pausedPreferenceStayedEphemeral &&
        pauseEntriesUnchanged &&
        forgetEntryMutationExact &&
        !profileKeyLinePattern.test(forgot?.profile ?? '') &&
        pauseUsedMachineReadableControl &&
        forgetUsedReconciledKey,
    ),
    explicitPausedUpdateProven &&
      explicitPausedUpdateAvoidedAutopilotToggle &&
      profileControlStatesValid,
    Boolean(
      closeTimingProven &&
        closed?.status === 'complete' &&
        repeated &&
        closed.path === repeated.path &&
        closed.reference === repeated.reference &&
        closedSnapshots.every((item) => item.status !== 'active') &&
        !core.includes(closed.reference),
    ),
  ];
}
