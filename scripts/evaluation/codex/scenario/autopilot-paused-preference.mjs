import {
  pausedOrdinaryPreferenceStayedEphemeral,
  profileEntriesAreIdentical,
  profileEntryMutationIsExact,
} from '../eval-codex-support.mjs';

/**
 * @param {import('./assertion-types.mjs').AssertionContext} context
 * @param {ReturnType<typeof import('./autopilot-snapshots.mjs').buildAutopilotSnapshots> & ReturnType<typeof import('./autopilot-initial-profile.mjs').buildAutopilotInitialProfile>} state
 */
export function buildAutopilotPausedPreference(context, state) {
  const { memoryPayloadInvocations } = context;
  const { pause, pausedPreference, forgot, reconciledProfileKey } = state;
  const initialProfile = context.turnByLabel.get('initial')?.observation.profile ?? '';
  const pauseEntriesUnchanged = profileEntriesAreIdentical(initialProfile, pause?.profile);
  const pausedPreferenceReconcileAttempts = memoryPayloadInvocations.filter(
    (item) => item.turn === 'preference-while-paused' && item.action === 'reconcile-profile',
  );
  const pausedPreferenceProfileDigestUnchanged = Boolean(
    pause?.profileDigest && pause.profileDigest === pausedPreference?.profileDigest,
  );
  const pausedPreferenceStayedEphemeral = Boolean(
    pausedPreferenceReconcileAttempts.length === 0 &&
      pausedOrdinaryPreferenceStayedEphemeral({
        invocations: memoryPayloadInvocations,
        turn: 'preference-while-paused',
        beforeProfileDigest: pause?.profileDigest ?? undefined,
        afterProfileDigest: pausedPreference?.profileDigest ?? undefined,
      }),
  );
  const forgetEntryMutationExact = profileEntryMutationIsExact(
    pausedPreference?.profile,
    forgot?.profile,
    { removedKeys: [reconciledProfileKey] },
  );
  return {
    pauseEntriesUnchanged,
    pausedPreferenceReconcileAttempts,
    pausedPreferenceProfileDigestUnchanged,
    pausedPreferenceStayedEphemeral,
    forgetEntryMutationExact,
  };
}
