/**
 * @param {import('./assertion-types.mjs').AssertionContext} context
 * @param {ReturnType<typeof import('./autopilot-input-profile.mjs').buildAutopilotInputProfile> & ReturnType<typeof import('./autopilot-handoffs.mjs').buildAutopilotHandoffs>} state
 * @param {ReturnType<typeof import('./autopilot-signals.mjs').buildAutopilotSignals> & ReturnType<typeof import('./autopilot-close.mjs').buildAutopilotClose>} timing
 */
export function recordAutopilotObservations(context, state, timing) {
  const { observationArtifact } = context;
  observationArtifact.idempotency = {
    followCommandCount: state.followHandoffs.length,
    repeatedCommandCount: state.repeatedHandoffs.length,
    followPayloadPath: state.followInvocation?.resolvedPayloadPath ?? null,
    repeatedPayloadPath: state.repeatedInvocation?.resolvedPayloadPath ?? null,
    followPayloadCanonicalSha256: state.followInvocation?.payload?.canonicalJsonSha256 ?? null,
    repeatedPayloadCanonicalSha256: state.repeatedInvocation?.payload?.canonicalJsonSha256 ?? null,
    followOutput: state.followOutput ?? null,
    followOutputObserved: state.followOutputObserved,
    repeatedOutput: state.repeatedOutput ?? null,
    repeatedOutputObserved: state.repeatedOutputObserved,
    proven: state.idempotencyProven,
  };
  observationArtifact.closeTiming = {
    attemptCount: timing.closeHandoffAttempts.length,
    turns: timing.closeHandoffAttempts.map((item) => item.turn),
    proven: timing.closeTimingProven,
  };
  observationArtifact.handoffReconciliation = {
    preVerificationProven: state.preVerificationProven,
    followOpenReconciliationProven: state.followOpenReconciliationProven,
    followClearOpen: state.followInvocation?.payload?.value?.clearOpen === true,
    followPayloadOmitsOpen:
      state.followInvocation?.payload?.ok === true &&
      state.followInvocation.payload.value &&
      !Object.hasOwn(state.followInvocation.payload.value, 'open'),
  };
  observationArtifact.userInvisible = {
    pureSignalVisibleMessageCounts: timing.pureSignalVisibleMessageCounts,
    pureSignalResponseCompliance: timing.pureSignalResponseCompliance,
    pureSignalResponsesComply: timing.pureSignalResponsesComply,
    pausedPreferenceResponseIsOpaque: timing.pausedPreferenceResponseIsOpaque,
    pausedPreferenceReconcileAttemptCount: state.pausedPreferenceReconcileAttempts.length,
    pausedPreferenceProfileDigestUnchanged: state.pausedPreferenceProfileDigestUnchanged,
    pausedPreferenceStayedEphemeral: state.pausedPreferenceStayedEphemeral,
  };
  observationArtifact.invalidCheckpointReasonAttempts = timing.invalidCheckpointReasonAttempts;
}
