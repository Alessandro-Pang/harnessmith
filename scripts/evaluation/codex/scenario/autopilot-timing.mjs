import { buildAutopilotClose } from './autopilot-close.mjs';
import { recordAutopilotObservations } from './autopilot-observations.mjs';
import { buildAutopilotSignals } from './autopilot-signals.mjs';

/**
 * @param {import('./assertion-types.mjs').AssertionContext} context
 * @param {ReturnType<typeof import('./autopilot-input-profile.mjs').buildAutopilotInputProfile> & ReturnType<typeof import('./autopilot-handoffs.mjs').buildAutopilotHandoffs> & ReturnType<typeof import('./autopilot-controls.mjs').buildAutopilotControls>} state
 */
export function buildAutopilotTiming(context, state) {
  const signals = buildAutopilotSignals(context);
  const close = buildAutopilotClose(context);
  const timing = { ...signals, ...close };
  recordAutopilotObservations(context, state, timing);
  return {
    closedSnapshots: signals.closedSnapshots,
    pureSignalVisibleMessageCounts: signals.pureSignalVisibleMessageCounts,
    pureSignalResponsesComply: signals.pureSignalResponsesComply,
    pausedPreferenceResponseIsOpaque: signals.pausedPreferenceResponseIsOpaque,
    invalidCheckpointReasonAttempts: signals.invalidCheckpointReasonAttempts,
    closeTimingProven: close.closeTimingProven,
  };
}
