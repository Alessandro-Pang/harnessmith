import {
  handoffPayloadProvesClearedOpen,
  verificationEvidenceProvesSuccessfulCommand,
} from '../eval-codex-support.mjs';

/**
 * @param {import('./assertion-types.mjs').AssertionContext} context
 * @param {ReturnType<typeof import('./autopilot-input-profile.mjs').buildAutopilotInputProfile> & ReturnType<typeof import('./autopilot-handoff-commands.mjs').buildAutopilotHandoffCommands>} state
 */
export function buildAutopilotFollowUp(context, state) {
  const { checkpointIdempotencyIsProven } = context;
  const {
    pre,
    follow,
    repeated,
    followOpen,
    followVerification,
    followTurn,
    repeatedTurn,
    followInvocation,
    repeatedInvocation,
    followOutput,
    repeatedOutput,
    repeatedOutputObserved,
    handoffCommandIsExact,
    followVerifier,
  } = state;
  const followOpenReconciliationProven = Boolean(
    handoffCommandIsExact(followInvocation) &&
      handoffPayloadProvesClearedOpen(followInvocation, followVerifier) &&
      followOpen.trim() === '' &&
      verificationEvidenceProvesSuccessfulCommand(followVerification, followVerifier),
  );
  const followOutputObserved = Boolean(followInvocation?.output.trim());
  const decisionsPreserved = context
    .section(follow?.content, '关键决策')
    .includes('Use verify-autopilot.mjs with the requested path.');
  const omittedDecisionsPreserved = Boolean(
    decisionsPreserved &&
      followInvocation?.payload?.ok &&
      followInvocation.payload.value &&
      !Object.hasOwn(followInvocation.payload.value, 'decisions'),
  );
  const idempotencyProven = checkpointIdempotencyIsProven({
    followCommandExact:
      handoffCommandIsExact(followInvocation) && Boolean(followInvocation?.payload?.ok),
    repeatedCommandExact:
      handoffCommandIsExact(repeatedInvocation) && Boolean(repeatedInvocation?.payload?.ok),
    samePayloadPath:
      followInvocation?.resolvedPayloadPath === repeatedInvocation?.resolvedPayloadPath,
    samePayloadSha:
      followInvocation?.payload?.canonicalJsonSha256 ===
      repeatedInvocation?.payload?.canonicalJsonSha256,
    followOutput,
    followOutputObserved,
    repeatedOutput,
    repeatedOutputObserved,
    expectedPath: follow?.path,
    expectedReference: follow?.reference,
    preToFollowChanged: Boolean(
      pre && follow && pre.path === follow.path && pre.digest !== follow.digest,
    ),
    followToRepeatUnchanged: Boolean(
      follow && repeated && follow.path === repeated.path && follow.digest === repeated.digest,
    ),
    projectDigestUnchanged:
      followTurn?.observation.projectMemoryDigest === repeatedTurn?.observation.projectMemoryDigest,
  });
  return { followOpenReconciliationProven, omittedDecisionsPreserved, idempotencyProven };
}
