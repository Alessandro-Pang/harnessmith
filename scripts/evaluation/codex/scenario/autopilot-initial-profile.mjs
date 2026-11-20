import {
  memoryPayloadOutputIsCompatible,
  profileEntryMutationIsExact,
  selectSingleSuccessfulMemoryPayloadInvocation,
} from '../eval-codex-support.mjs';

/**
 * @param {import('./assertion-types.mjs').AssertionContext} context
 */
export function buildAutopilotInitialProfile(context) {
  const { baselineObservation, memoryPayloadInvocations, turnByLabel } = context;
  const reconcileProfileInvocation = selectSingleSuccessfulMemoryPayloadInvocation(
    memoryPayloadInvocations,
    {
      turn: 'initial',
      action: 'reconcile-profile',
      outputActions: ['created', 'updated'],
      allowUnobserved: true,
    },
  );
  const reconciledProfileKey = String(reconcileProfileInvocation?.payload?.value?.key ?? '');
  const safeReconciledProfileKey = /^communication\.[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(
    reconciledProfileKey,
  );
  const escapedReconciledProfileKey = reconciledProfileKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const profileKeyLinePattern = safeReconciledProfileKey
    ? new RegExp(`^- ${escapedReconciledProfileKey} \\|`, 'm')
    : /$a/u;
  const initialProfile = turnByLabel.get('initial')?.observation.profile ?? '';
  const initialProfileEntryMutationExact = profileEntryMutationIsExact(
    baselineObservation.profile,
    initialProfile,
    { addedKeys: [reconciledProfileKey] },
  );
  const reconcileOutputCompatible = memoryPayloadOutputIsCompatible(
    reconcileProfileInvocation?.output,
    {
      kind: 'profile',
      actions: ['created', 'updated'],
      allowUnobserved: reconcileProfileInvocation?.outputObserved === false,
    },
  );
  const explicitProfileReconcileProven = Boolean(
    reconcileProfileInvocation?.exact &&
      reconcileProfileInvocation.completed &&
      reconcileProfileInvocation.payload?.ok &&
      safeReconciledProfileKey &&
      /(?:one sentence|一句话)/i.test(
        String(reconcileProfileInvocation.payload?.value?.conclusion ?? ''),
      ) &&
      reconcileProfileInvocation.payload?.value?.evidence === 'explicit' &&
      reconcileProfileInvocation.payload?.value?.confidence === 'high' &&
      reconcileOutputCompatible &&
      initialProfileEntryMutationExact &&
      profileKeyLinePattern.test(initialProfile),
  );
  const prePauseProfile = turnByLabel.get('repeat-identical-checkpoint')?.observation.profile ?? '';
  const explicitOneSentencePreference =
    safeReconciledProfileKey &&
    new RegExp(
      `^- ${escapedReconciledProfileKey} \\| [^\\r\\n|]*(?:one sentence|一句话)[^\\r\\n|]* \\| explicit \\| high \\| \\d{4}-\\d{2}-\\d{2}$`,
      'im',
    ).test(prePauseProfile);
  return {
    explicitProfileReconcileProven,
    explicitOneSentencePreference,
    reconciledProfileKey,
    profileKeyLinePattern,
    initialProfileEntryMutationExact,
  };
}
