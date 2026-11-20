import { join } from 'node:path';

const broadProjectReadPattern =
  /(?:^|[;&|]\s*|\s)(?:find|tree)\b|\brg\s+--files\b|\bls\s+(?:-[^\s]*R[^\s]*)?\b|\bgit\s+(?:status|diff|show|ls-files)\b/i;

/**
 * @param {import('./assertion-types.mjs').AssertionContext} context
 * @param {ReturnType<typeof import('./profile-recall-actions.mjs').buildProfileRecallActions>} state
 */
export function buildProfileProjectAccess(context, state) {
  const { repo, fixtureTrackedPaths } = context;
  const { orderedActions, profileAction, profilePattern } = state;
  const bootstrapExemptions = new Set(['README.md', 'EVAL_CONTEXT.md']);
  const projectTrackedPaths = fixtureTrackedPaths.filter((path) => !bootstrapExemptions.has(path));
  const projectWork = orderedActions.filter((action) => {
    let text = action.text;
    for (const exempt of bootstrapExemptions) {
      text = text.replaceAll(join(repo, exempt), '').replaceAll(exempt, '');
    }
    const bootstrapOnlyList = /^\s*ls(?:\s+-[^\s]+)?\s*$/.test(text);
    const namesProjectFile = projectTrackedPaths.some(
      (path) => text.includes(path) || text.includes(join(repo, path)),
    );
    const broadProjectRead = action.type === 'command' && broadProjectReadPattern.test(text);
    return namesProjectFile || (broadProjectRead && !bootstrapOnlyList);
  });
  const projectBeforeProfile = projectWork.filter((action) => {
    if (!profileAction) return true;
    if (action.eventIndex < profileAction.eventIndex) return true;
    if (action.eventIndex > profileAction.eventIndex) return false;
    profilePattern.lastIndex = 0;
    const profileOffset = profilePattern.exec(action.text)?.index ?? -1;
    const projectOffsets = projectTrackedPaths
      .flatMap((path) => [action.text.indexOf(path), action.text.indexOf(join(repo, path))])
      .filter((index) => index >= 0);
    const broadOffset = action.text.search(broadProjectReadPattern);
    if (broadOffset >= 0) projectOffsets.push(broadOffset);
    return projectOffsets.some((index) => profileOffset < 0 || index < profileOffset);
  });
  return { projectWork, projectBeforeProfile };
}
