import { commandInvokesReadTool } from '../eval-codex-support.mjs';

/** @param {import('./assertion-types.mjs').AssertionContext} context */
export function buildProfileRecallActions(context) {
  const { memory, jsonEvents, turnByLabel } = context;
  const turn = turnByLabel.get('initial');
  const orderedActions = jsonEvents(turn?.result.stdout ?? '').flatMap((event, eventIndex) => {
    const item = event?.item;
    if (event?.type !== 'item.completed' || !item) return [];
    if (item.type === 'command_execution') {
      return [{ eventIndex, type: 'command', text: String(item.command ?? '') }];
    }
    if (/read/i.test(String(item.type ?? ''))) {
      return [
        {
          eventIndex,
          type: String(item.type),
          text: String(item.path ?? item.file_path ?? item.target ?? JSON.stringify(item)),
        },
      ];
    }
    return [];
  });
  const trace = orderedActions.map((action) => action.text).join('\n');
  const escapedMemory = memory.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const profilePattern = new RegExp(
    `(?:${escapedMemory}|\\$\\{?HARNESS_MEMORY_HOME\\}?)[\\/]+profile\\.md`,
    'g',
  );
  const profileMatches = [...trace.matchAll(profilePattern)];
  const profileActions = orderedActions.filter((action) => {
    profilePattern.lastIndex = 0;
    return profilePattern.test(action.text);
  });
  const profileAction = profileActions.length === 1 ? profileActions[0] : null;
  const profileIsFirstObservedAction = Boolean(
    profileAction && orderedActions[0]?.eventIndex === profileAction.eventIndex,
  );
  const profileReadVerb = Boolean(
    profileAction &&
      (profileAction.type !== 'command' || commandInvokesReadTool(profileAction.text)),
  );
  return {
    turn,
    orderedActions,
    escapedMemory,
    profilePattern,
    profileAction,
    profileMatches,
    profileIsFirstObservedAction,
    profileReadVerb,
  };
}
