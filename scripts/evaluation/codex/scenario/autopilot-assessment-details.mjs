import { profileEntryMutationIsExact } from '../eval-codex-support.mjs';

/**
 * @param {import('./assertion-types.mjs').AssertionContext} context
 * @param {import('./autopilot-evidence-types.mjs').AutopilotEvidence} state
 */
export function autopilotAssessmentDetails(context, state) {
  const {
    treeErrors,
    boundaryViolations,
    verifiersPassed,
    routineAnnouncementEvidence,
    explicitProfileControlRoutingViolations,
    nativeCompactionEvent,
  } = context;
  const {
    pre,
    forgot,
    explicitPausedUpdate,
    captureInputInvocations,
    evaluatorCompactionSignal,
    preReferenceCount,
    preVerificationProven,
    preCompleted,
    preNext,
    preNextVerifierProven,
    followOpenReconciliationProven,
    followInvocation,
    repeatedInvocation,
    repeatedOutput,
    repeatedHandoffs,
    projectBoundaryOk,
    globalBoundaryOk,
    initialProfileEntryMutationExact,
    pauseUsedMachineReadableControl,
    pauseEntriesUnchanged,
    pausedPreferenceReconcileAttempts,
    pausedPreferenceProfileDigestUnchanged,
    forgetUsedReconciledKey,
    forgetEntryMutationExact,
    pureSignalVisibleMessageCounts,
    pureSignalResponsesComply,
    pausedPreferenceResponseIsOpaque,
    invalidCheckpointReasonAttempts,
    explicitPausedUpdateProven,
    explicitPausedUpdateKey,
    explicitPausedUpdateControlAttempts,
    profileControlStatesValid,
  } = state;
  return [
    `capture-attempts=${captureInputInvocations.length}; successful=${captureInputInvocations.filter((item) => item.exact && item.completed && item.payload?.ok).length}`,
    `evaluator-compaction-signal=${evaluatorCompactionSignal}; native-compaction-event=${nativeCompactionEvent}; native event availability remains separately observable`,
    `compaction-reason=${pre?.reason === 'compaction'}; core-ref-count=${preReferenceCount}; initial-verifier=${verifiersPassed('initial')}; handoff-verification-current=${preVerificationProven}; completed-concrete=${/docs\/status\.txt/i.test(preCompleted) && /ready|verif(?:y|ied)|pass(?:ed)?|通过|验证/i.test(preCompleted)}; next-file=${/follow-up\.txt/.test(preNext)}; next-verifier=${preNextVerifierProven}`,
    `follow-open-reconciled=${followOpenReconciliationProven}; clearOpen=${followInvocation?.payload?.value?.clearOpen === true}; payload-omits-open=${followInvocation?.payload?.ok === true && followInvocation.payload.value && !Object.hasOwn(followInvocation.payload.value, 'open')}`,
    `repeat-identical-checkpoint is evaluator instrumentation, not a user persistence request; command-count=${repeatedHandoffs.length}; action=${String(repeatedOutput?.action)}; same-payload-path=${followInvocation?.resolvedPayloadPath === repeatedInvocation?.resolvedPayloadPath}; same-payload-sha=${followInvocation?.payload?.canonicalJsonSha256 === repeatedInvocation?.payload?.canonicalJsonSha256}`,
    `routine-announcements=${routineAnnouncementEvidence.length}; explicit-control-routing-violations=${explicitProfileControlRoutingViolations.length}; initial-entry-delta-exact=${initialProfileEntryMutationExact}; pause-machine-readable=${pauseUsedMachineReadableControl}; pause-entries-unchanged=${pauseEntriesUnchanged}; paused-preference-reconcile-attempts=${pausedPreferenceReconcileAttempts.length}; paused-preference-profile-digest-unchanged=${pausedPreferenceProfileDigestUnchanged}; forget-exact-key=${forgetUsedReconciledKey}; forget-entry-delta-exact=${forgetEntryMutationExact}`,
    `pure-signal-visible-message-counts=${JSON.stringify(pureSignalVisibleMessageCounts)}; response-policy=${pureSignalResponsesComply}; paused-preference-response-opaque=${pausedPreferenceResponseIsOpaque}; invalid-checkpoint-reason-attempts=${invalidCheckpointReasonAttempts.length}`,
    `explicit-paused-update=${explicitPausedUpdateProven}; key=${explicitPausedUpdateKey || 'none'}; entry-delta-exact=${profileEntryMutationIsExact(forgot?.profile, explicitPausedUpdate?.profile, { addedKeys: [explicitPausedUpdateKey] })}; remains-paused=${explicitPausedUpdate?.profile?.includes('profile-autopilot: paused') === true}; autopilot-toggle-attempts=${explicitPausedUpdateControlAttempts.length}; profile-checks-valid=${profileControlStatesValid}`,
    `boundary-project=${projectBoundaryOk}; boundary-global=${globalBoundaryOk}; remote-or-destructive=${boundaryViolations.length}; tree-errors=${treeErrors.length}`,
  ];
}
