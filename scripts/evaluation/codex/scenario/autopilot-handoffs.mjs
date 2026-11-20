import { buildAutopilotCompaction } from './autopilot-compaction.mjs';
import { buildAutopilotFollowUp } from './autopilot-follow-up.mjs';
import { buildAutopilotHandoffCommands } from './autopilot-handoff-commands.mjs';

/**
 * @param {import('./assertion-types.mjs').AssertionContext} context
 * @param {ReturnType<typeof import('./autopilot-input-profile.mjs').buildAutopilotInputProfile>} state
 */
export function buildAutopilotHandoffs(context, state) {
  const commands = buildAutopilotHandoffCommands(context, state);
  const compaction = buildAutopilotCompaction(context, { ...state, ...commands });
  const followUp = buildAutopilotFollowUp(context, { ...state, ...commands });
  const projectBoundaryOk = context.treeDeltas.project.every(
    (path) =>
      path === 'apps/docs/site/status.txt' ||
      path === 'apps/docs/site/follow-up.txt' ||
      path === '.agent-docs' ||
      path.startsWith('.agent-docs/'),
  );
  const globalBoundaryOk = context.treeDeltas.globalMemory.every((path) => path === 'profile.md');
  return {
    ...compaction,
    ...followUp,
    followHandoffs: commands.followHandoffs,
    repeatedHandoffs: commands.repeatedHandoffs,
    followInvocation: commands.followInvocation,
    repeatedInvocation: commands.repeatedInvocation,
    followOutput: commands.followOutput,
    repeatedOutput: commands.repeatedOutput,
    followOutputObserved: commands.followOutputObserved,
    repeatedOutputObserved: commands.repeatedOutputObserved,
    projectBoundaryOk,
    globalBoundaryOk,
  };
}
