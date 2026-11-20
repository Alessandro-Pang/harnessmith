import { commandInvokesReadTool } from '../eval-codex-support.mjs';

/**
 * @param {ReturnType<typeof import('./profile-recall-actions.mjs').buildProfileRecallActions>} state
 */
export function buildProfileGlobalAudit(state) {
  const { turn, orderedActions, escapedMemory, profilePattern } = state;
  const globalMemoryRootPattern = new RegExp(
    `(?:${escapedMemory}|\\$\\{?HARNESS_MEMORY_HOME\\}?)[\\/]`,
    'i',
  );
  const unrelatedGlobalBodyRead = orderedActions.some((action) => {
    const withoutProfile = action.text.replace(new RegExp(profilePattern.source, 'gi'), '');
    if (!globalMemoryRootPattern.test(withoutProfile)) return false;
    if (action.type !== 'command') return true;
    return (
      commandInvokesReadTool(action.text) ||
      /(?:^|[;&|('"]\s*|\s)(?:find|tree)\b|\bls\s+-[^\s]*R/i.test(action.text)
    );
  });
  return (
    unrelatedGlobalBodyRead ||
    String(turn?.result.stdout ?? '').includes('UNRELATED_PROFILE_RECALL_SENTINEL_7F92A1')
  );
}
