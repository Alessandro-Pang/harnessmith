import { buildAutopilotExplicitUpdate } from './autopilot-explicit-update.mjs';
import { buildAutopilotInitialProfile } from './autopilot-initial-profile.mjs';
import { buildAutopilotInputCapture } from './autopilot-input-capture.mjs';
import { buildAutopilotPausedPreference } from './autopilot-paused-preference.mjs';
import { buildAutopilotSnapshots } from './autopilot-snapshots.mjs';

/** @param {import('./assertion-types.mjs').AssertionContext} context */
export function buildAutopilotInputProfile(context) {
  const snapshots = buildAutopilotSnapshots(context);
  const input = buildAutopilotInputCapture(context, snapshots);
  const initial = buildAutopilotInitialProfile(context);
  const paused = buildAutopilotPausedPreference(context, { ...snapshots, ...initial });
  const explicit = buildAutopilotExplicitUpdate(context, { ...snapshots, ...initial });
  const state = { ...snapshots, ...input, ...initial, ...paused, ...explicit };
  const {
    core,
    initialHandoff,
    pre,
    follow,
    repeated,
    pause,
    pausedPreference,
    forgot,
    explicitPausedUpdate,
    closed,
    captureInputInvocations,
    typedInputCaptureProven,
    exactInputIndexed,
    explicitProfileReconcileProven,
    explicitOneSentencePreference,
    reconciledProfileKey,
    profileKeyLinePattern,
    initialProfileEntryMutationExact,
    pauseEntriesUnchanged,
    pausedPreferenceReconcileAttempts,
    pausedPreferenceProfileDigestUnchanged,
    pausedPreferenceStayedEphemeral,
    forgetEntryMutationExact,
    explicitPausedUpdateKey,
    explicitPausedUpdateProven,
  } = state;
  return {
    core,
    initialHandoff,
    pre,
    follow,
    repeated,
    pause,
    pausedPreference,
    forgot,
    explicitPausedUpdate,
    closed,
    captureInputInvocations,
    typedInputCaptureProven,
    exactInputIndexed,
    explicitProfileReconcileProven,
    explicitOneSentencePreference,
    reconciledProfileKey,
    profileKeyLinePattern,
    initialProfileEntryMutationExact,
    pauseEntriesUnchanged,
    pausedPreferenceReconcileAttempts,
    pausedPreferenceProfileDigestUnchanged,
    pausedPreferenceStayedEphemeral,
    forgetEntryMutationExact,
    explicitPausedUpdateKey,
    explicitPausedUpdateProven,
  };
}
