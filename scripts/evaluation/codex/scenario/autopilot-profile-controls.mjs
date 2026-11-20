import { profileControlCommandMatches } from './autopilot-control-command.mjs';

/** @param {import('./assertion-types.mjs').AssertionContext} context */
function pauseControl(context) {
  const { completedCommandItems, turnByLabel, isReadOnlyMemoryHelp } = context;
  const attempts = completedCommandItems(turnByLabel.get('pause-profile')).filter(
    (item) =>
      /\bmemory\s+profile-autopilot\s+pause\b/i.test(item.command) &&
      !isReadOnlyMemoryHelp(item.command),
  );
  const proven =
    attempts.length === 1 &&
    attempts.every((item) =>
      profileControlCommandMatches(context, item, [
        'memory',
        'profile-autopilot',
        'pause',
        '--json',
      ]),
    );
  return { attempts, proven };
}

/**
 * @param {import('./assertion-types.mjs').AssertionContext} context
 * @param {string} reconciledProfileKey
 */
function forgetControl(context, reconciledProfileKey) {
  const { completedCommandItems, turnByLabel, isReadOnlyMemoryHelp } = context;
  const attempts = completedCommandItems(turnByLabel.get('forget-profile')).filter(
    (item) =>
      /\bmemory\s+forget-profile\b/i.test(item.command) && !isReadOnlyMemoryHelp(item.command),
  );
  const proven =
    attempts.length === 1 &&
    attempts.every((item) =>
      profileControlCommandMatches(context, item, [
        'memory',
        'forget-profile',
        '--key',
        reconciledProfileKey,
        '--json',
      ]),
    );
  return { attempts, proven };
}

/** @param {import('./assertion-types.mjs').AssertionContext} context */
function profileValidation(context) {
  const validation = Object.fromEntries(
    [
      'initial',
      'pause-profile',
      'preference-while-paused',
      'forget-profile',
      'explicit-profile-update-while-paused',
    ].map((label) => [
      label,
      context.turnByLabel.get(label)?.observation.globalMemoryCheck?.valid === true,
    ]),
  );
  return { validation, valid: Object.values(validation).every(Boolean) };
}

/**
 * @param {import('./assertion-types.mjs').AssertionContext} context
 * @param {ReturnType<typeof import('./autopilot-input-profile.mjs').buildAutopilotInputProfile>} state
 */
export function buildAutopilotProfileControls(context, state) {
  const { completedCommandItems, turnByLabel, isReadOnlyMemoryHelp, observationArtifact } = context;
  const pause = pauseControl(context);
  const forget = forgetControl(context, state.reconciledProfileKey);
  const validation = profileValidation(context);
  const explicitPausedUpdateControlAttempts = completedCommandItems(
    turnByLabel.get('explicit-profile-update-while-paused'),
  ).filter(
    (item) =>
      /\bmemory\s+profile-autopilot\s+(?:pause|resume)\b/i.test(item.command) &&
      !isReadOnlyMemoryHelp(item.command),
  );
  const explicitPausedUpdateAvoidedAutopilotToggle =
    explicitPausedUpdateControlAttempts.length === 0;
  observationArtifact.profileControls = {
    pauseAttemptCount: pause.attempts.length,
    pauseUsedMachineReadableControl: pause.proven,
    forgetAttemptCount: forget.attempts.length,
    forgetUsedReconciledKey: forget.proven,
    reconciledProfileKey: state.reconciledProfileKey,
    initialProfileEntryMutationExact: state.initialProfileEntryMutationExact,
    explicitPausedUpdateKey: state.explicitPausedUpdateKey,
    explicitPausedUpdateProven: state.explicitPausedUpdateProven,
    explicitPausedUpdateControlAttemptCount: explicitPausedUpdateControlAttempts.length,
    explicitPausedUpdateAvoidedAutopilotToggle,
    validation: validation.validation,
    profileControlStatesValid: validation.valid,
    pauseEntriesUnchanged: state.pauseEntriesUnchanged,
    forgetEntryMutationExact: state.forgetEntryMutationExact,
  };
  return {
    pauseUsedMachineReadableControl: pause.proven,
    explicitPausedUpdateControlAttempts,
    explicitPausedUpdateAvoidedAutopilotToggle,
    profileControlStatesValid: validation.valid,
    forgetUsedReconciledKey: forget.proven,
  };
}
