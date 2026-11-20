import {
  isCodeReviewProfileKey,
  memoryPayloadOutputIsCompatible,
  profileEntryMutationIsExact,
  selectSingleSuccessfulMemoryPayloadInvocation,
  singleExactPayloadMutationAttempt,
} from '../eval-codex-support.mjs';

/**
 * @param {import('./assertion-types.mjs').AssertionContext} context
 * @param {ReturnType<typeof import('./autopilot-snapshots.mjs').buildAutopilotSnapshots> & ReturnType<typeof import('./autopilot-initial-profile.mjs').buildAutopilotInitialProfile>} state
 */
export function buildAutopilotExplicitUpdate(context, state) {
  const { memoryPayloadInvocations } = context;
  const { forgot, explicitPausedUpdate, reconciledProfileKey, profileKeyLinePattern } = state;
  const explicitPausedUpdateInvocation = selectSingleSuccessfulMemoryPayloadInvocation(
    memoryPayloadInvocations,
    {
      turn: 'explicit-profile-update-while-paused',
      action: 'reconcile-profile',
      outputActions: ['created', 'updated'],
      allowUnobserved: true,
    },
  );
  const explicitPausedUpdateKey = String(explicitPausedUpdateInvocation?.payload?.value?.key ?? '');
  const safeExplicitPausedUpdateKey = isCodeReviewProfileKey(
    explicitPausedUpdateKey,
    reconciledProfileKey,
  );
  const escapedExplicitPausedUpdateKey = explicitPausedUpdateKey.replace(
    /[.*+?^${}()|[\]\\]/g,
    '\\$&',
  );
  const explicitPausedUpdateLinePattern = safeExplicitPausedUpdateKey
    ? new RegExp(
        `^- ${escapedExplicitPausedUpdateKey} \\| [^\\r\\n|]*(?:risk-first|risk first|风险优先)[^\\r\\n|]* \\| explicit \\| high \\| \\d{4}-\\d{2}-\\d{2}$`,
        'im',
      )
    : /$a/u;
  const explicitPausedUpdateOutputCompatible = memoryPayloadOutputIsCompatible(
    explicitPausedUpdateInvocation?.output,
    {
      kind: 'profile',
      actions: ['created', 'updated'],
      allowUnobserved: explicitPausedUpdateInvocation?.outputObserved === false,
    },
  );
  const explicitPausedUpdateProven = Boolean(
    singleExactPayloadMutationAttempt(memoryPayloadInvocations, explicitPausedUpdateInvocation, {
      turn: 'explicit-profile-update-while-paused',
      action: 'reconcile-profile',
    }) &&
      safeExplicitPausedUpdateKey &&
      explicitPausedUpdateInvocation?.payload?.value?.userDirected === true &&
      explicitPausedUpdateInvocation?.payload?.value?.evidence === 'explicit' &&
      explicitPausedUpdateInvocation?.payload?.value?.confidence === 'high' &&
      /risk-first|risk first|风险优先/i.test(
        String(explicitPausedUpdateInvocation?.payload?.value?.conclusion ?? ''),
      ) &&
      explicitPausedUpdateOutputCompatible &&
      explicitPausedUpdate?.profile?.includes('profile-autopilot: paused') &&
      explicitPausedUpdateLinePattern.test(explicitPausedUpdate.profile) &&
      !profileKeyLinePattern.test(explicitPausedUpdate.profile) &&
      profileEntryMutationIsExact(forgot?.profile, explicitPausedUpdate.profile, {
        addedKeys: [explicitPausedUpdateKey],
      }),
  );
  return { explicitPausedUpdateKey, explicitPausedUpdateProven };
}
