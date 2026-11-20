/** @param {import('./assertion-types.mjs').AssertionContext} context */
export function buildAutopilotSignals(context) {
  const {
    turnResults,
    turnAgentMessages,
    turnVisibleAgentMessages,
    turnByLabel,
    sessionSnapshots,
  } = context;
  const closedSnapshots = sessionSnapshots('host-thread-42');
  const pureSignalVisibleMessages = Object.fromEntries(
    ['pre-compaction-signal', 'repeat-identical-checkpoint'].map((label) => [
      label,
      turnVisibleAgentMessages(turnByLabel.get(label)),
    ]),
  );
  const pureSignalVisibleMessageCounts = Object.fromEntries(
    Object.entries(pureSignalVisibleMessages).map(([label, messages]) => [label, messages.length]),
  );
  const pureSignalResponseCompliance = Object.fromEntries(
    Object.entries(pureSignalVisibleMessages).map(([label]) => [label, null]),
  );
  const pureSignalResponsesComply = null;
  const pausedPreferenceMessages = turnAgentMessages(
    turnByLabel.get('preference-while-paused'),
  ).join('\n');
  const pausedPreferenceResponseIsOpaque = null;
  const invalidCheckpointReasonAttempts = turnResults.flatMap((turn) =>
    (turn.handoffEvidence ?? []).flatMap((item) =>
      item.completed !== true && /Invalid handoff checkpoint reason/i.test(item.output ?? '')
        ? [{ turn: turn.label, command: item.command, output: item.output }]
        : [],
    ),
  );
  return {
    closedSnapshots,
    pureSignalVisibleMessageCounts,
    pureSignalResponseCompliance,
    pureSignalResponsesComply,
    pausedPreferenceMessages,
    pausedPreferenceResponseIsOpaque,
    invalidCheckpointReasonAttempts,
  };
}
