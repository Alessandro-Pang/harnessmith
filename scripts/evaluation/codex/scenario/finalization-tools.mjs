import { observedApproval } from './finalization-logic.mjs';

/** @param {unknown} change */
function fileChangePath(change) {
  if (!change || typeof change !== 'object' || Array.isArray(change) || !('path' in change)) {
    return null;
  }
  return typeof change.path === 'string' ? change.path : null;
}

/**
 * @param {{ turnResults: import('../support/types.mjs').ScenarioTurn[], host: string, jsonEvents: (stdout: unknown) => import('../support/types.mjs').CodexEvent[], sanitizeAndBoundArtifact: import('../support/types.mjs').ArtifactSanitizer }} input
 */
export function collectToolActions({ turnResults, host, jsonEvents, sanitizeAndBoundArtifact }) {
  /** @type {import('../support/types.mjs').ToolAction[]} */
  const toolActions = [];
  let actionSequence = 0;
  /** @param {import('../support/types.mjs').ToolAction} action */
  const append = (action) => {
    if (toolActions.length >= 1024) return;
    toolActions.push({ ...action, sequence: ++actionSequence });
  };
  for (const turn of turnResults) {
    for (const event of jsonEvents(turn.result.stdout)) {
      collectEventAction({ event, turn, host, sanitizeAndBoundArtifact, append });
    }
    if (turn.verifier) {
      append({
        tool: 'evaluator.verifier',
        kind: 'execute',
        target: turn.verifier.command.join(' '),
        outcome: turn.verifier.integrity && turn.verifier.status === 0 ? 'completed' : 'failed',
        approval: 'not-required',
      });
    }
  }
  return toolActions;
}

/**
 * @param {{ event: import('../support/types.mjs').CodexEvent, turn: import('../support/types.mjs').ScenarioTurn, host: string, sanitizeAndBoundArtifact: import('../support/types.mjs').ArtifactSanitizer, append: (action: import('../support/types.mjs').ToolAction) => void }} input
 */
function collectEventAction({ event, turn, host, sanitizeAndBoundArtifact, append }) {
  if (event.type === 'context_compacted' || event.type === 'context.compacted') {
    append({
      tool: `${host}.context_compacted`,
      kind: 'other',
      target: turn.label,
      outcome: 'completed',
      approval: 'not-requested',
    });
  }
  if (event.type !== 'item.completed' || !event.item) return;
  const item = event.item;
  if (item.type === 'command_execution') {
    append({
      tool: `${host}.command_execution`,
      kind: 'execute',
      target: sanitizeAndBoundArtifact(String(item.command || '(command unavailable)'), 1024)
        .content,
      outcome: item.status === 'completed' && item.exit_code === 0 ? 'completed' : 'failed',
      approval: observedApproval(event),
    });
  }
  if (item.type === 'file_change') {
    const targets = (Array.isArray(item.changes) ? item.changes : [])
      .map(fileChangePath)
      .filter((path) => path !== null);
    append({
      tool: `${host}.file_change`,
      kind: 'write',
      target: sanitizeAndBoundArtifact(targets.join(', ') || '(file path unavailable)', 1024)
        .content,
      outcome: item.status === 'completed' ? 'completed' : 'failed',
      approval: observedApproval(event),
    });
  }
  if (item.type === 'agent_message') {
    append({
      tool: `${host}.agent_message`,
      kind: 'other',
      target: turn.label,
      outcome: item.status === 'failed' ? 'failed' : 'completed',
      approval: 'not-required',
    });
  }
  if (
    typeof item.type === 'string' &&
    ['web_search', 'mcp_tool_call', 'network_request'].includes(item.type)
  ) {
    append({
      tool: `${host}.${item.type}`,
      kind: ['web_search', 'network_request'].includes(item.type) ? 'network' : 'other',
      target: sanitizeAndBoundArtifact(
        String(item.query || item.name || item.server || '(target unavailable)'),
        1024,
      ).content,
      outcome: item.status === 'completed' ? 'completed' : 'failed',
      approval: observedApproval(event),
    });
  }
}
