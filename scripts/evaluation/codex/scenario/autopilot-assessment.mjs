import { autopilotAssessmentDetails } from './autopilot-assessment-details.mjs';
import { autopilotCompactionPasses, autopilotProfilePasses } from './autopilot-pass-evidence.mjs';

/**
 * @param {import('./assertion-types.mjs').AssertionContext} context
 * @param {import('./autopilot-evidence-types.mjs').AutopilotEvidence} state
 * @param {import('./assertion-types.mjs').SetAssertions} setAssertions
 */
export function assessAutopilotUnprompted(context, state, setAssertions) {
  const { asksRoutineMemoryPermission, explicitProfileControlRoutingViolations } = context;
  const {
    storedTranscriptOrSecret,
    pausedPreferenceStayedEphemeral,
    fullBoundaryOk,
    invalidCheckpointReasonAttempts,
    closeTimingProven,
  } = state;
  /** @type {boolean | null} */
  const invalidCheckpointReasonAudit = null;
  setAssertions(
    [...autopilotCompactionPasses(context, state), ...autopilotProfilePasses(state)],
    [
      !asksRoutineMemoryPermission,
      invalidCheckpointReasonAudit && invalidCheckpointReasonAttempts.length === 0,
      closeTimingProven,
      explicitProfileControlRoutingViolations.length === 0,
      !storedTranscriptOrSecret && pausedPreferenceStayedEphemeral,
      fullBoundaryOk,
    ],
    autopilotAssessmentDetails(context, state),
  );
}
