import { toolActionArtifactBounds } from '../eval-codex-support.mjs';

/**
 * @param {import('./execution-types.mjs').ScenarioExecutionContext} context
 * @param {ReturnType<typeof import('./execution-setup.mjs').createScenarioServices>} services
 * @param {Awaited<ReturnType<typeof import('./execution-turns.mjs').executeScenarioTurns>>} turns
 * @param {ReturnType<typeof import('./execution-artifacts.mjs').createRunArtifacts>} artifacts
 */
export function collectScenarioToolActions(context, services, turns, artifacts) {
  /** @type {import('../support/types.mjs').ToolActionDescriptor[]} */
  const rawToolActionDescriptors = [];
  for (const turn of turns.turnResults) {
    for (const event of services.jsonEvents(turn.result.stdout)) {
      if (event?.type === 'context_compacted' || event?.type === 'context.compacted') {
        rawToolActionDescriptors.push({
          turn: turn.label,
          type: 'context_compacted',
          target: turn.label,
        });
        continue;
      }
      const item = event?.item;
      if (event?.type !== 'item.completed' || !item) continue;
      if (item.type === 'command_execution') {
        rawToolActionDescriptors.push({
          turn: turn.label,
          type: item.type,
          target: String(item.command ?? ''),
        });
      } else if (item.type === 'file_change') {
        rawToolActionDescriptors.push({
          turn: turn.label,
          type: item.type,
          target: (Array.isArray(item.changes) ? item.changes : [])
            .map((change) => change?.path)
            .filter(Boolean)
            .join(', '),
        });
      } else if (item.type === 'agent_message') {
        rawToolActionDescriptors.push({ turn: turn.label, type: item.type, target: turn.label });
      } else if (
        typeof item.type === 'string' &&
        ['web_search', 'mcp_tool_call', 'network_request'].includes(item.type)
      ) {
        rawToolActionDescriptors.push({
          turn: turn.label,
          type: item.type,
          target: String(item.query ?? item.name ?? item.server ?? '(target unavailable)'),
        });
      }
    }
    if (turn.verifier) {
      rawToolActionDescriptors.push({
        turn: turn.label,
        type: 'evaluator.verifier',
        target: turn.verifier.command.join(' '),
      });
    }
  }
  const bounds = toolActionArtifactBounds(rawToolActionDescriptors);
  if (bounds.exceeded) {
    artifacts.evidenceComplete = false;
    context.evaluatorErrors.push(
      `toolActions exceeded schema-safe representation: count=${rawToolActionDescriptors.length}`,
    );
  }
  artifacts.observationArtifact.artifactBounds.toolActions = bounds;
  return rawToolActionDescriptors;
}
