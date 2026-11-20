import { buildProfileGlobalAudit } from './profile-global-audit.mjs';
import { buildProfileProjectAccess } from './profile-project-access.mjs';
import { buildProfileRecallActions } from './profile-recall-actions.mjs';

/**
 * @param {import('./assertion-types.mjs').AssertionContext} context
 * @param {import('./assertion-types.mjs').SetAssertions} setAssertions
 */
export function evaluateProfileRecall(context, setAssertions) {
  if (context.scenarioId !== 'memory-profile-cross-task-recall') return;
  const actions = buildProfileRecallActions(context);
  const project = buildProfileProjectAccess(context, actions);
  const recursiveGlobalRead = buildProfileGlobalAudit(actions);
  const profileIndex = actions.profileAction?.eventIndex ?? -1;
  const projectIndex = project.projectWork[0]?.eventIndex ?? -1;
  const profileMentions = actions.profileMatches.length;
  const profileUnchanged =
    context.baselineObservation.profileDigest === actions.turn?.observation.profileDigest;
  setAssertions(
    [
      profileIndex >= 0 &&
        projectIndex >= 0 &&
        actions.profileIsFirstObservedAction &&
        project.projectBeforeProfile.length === 0 &&
        profileMentions === 1 &&
        actions.profileReadVerb,
      null,
      profileUnchanged,
    ],
    [
      !context.scenario.prompt.includes('one sentence') &&
        !context.scenario.prompt.includes('remember'),
      null,
      profileUnchanged && !recursiveGlobalRead && context.memoryAutopilotBoundaryOk,
    ],
    [
      `profile-read-event-index=${profileIndex}; project-work-event-index=${projectIndex}; profile-path-mentions=${profileMentions}; project-before-profile=${project.projectBeforeProfile.map((action) => action.text).join(' | ') || '(none)'}`,
    ],
  );
}
