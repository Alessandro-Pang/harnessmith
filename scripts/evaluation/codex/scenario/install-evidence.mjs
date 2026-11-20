import { exactCommandTokens, parseInstallCaptureEnvelope } from '../eval-codex-support.mjs';
import { exactJsonObject } from './runtime.mjs';

/**
 * @param {{ fixturePaths: import('../support/types.mjs').FixturePaths, turnResults: import('../support/types.mjs').ScenarioTurn[], nodeBin: string, completedCommandItems: (turn: import('../support/types.mjs').ScenarioTurn | undefined) => import('../support/types.mjs').CommandEvidence[], finalObservation: import('../support/types.mjs').Observation, treeDeltas: import('../support/types.mjs').TreeDeltas }} input
 */
export function captureInstallEvidence({
  fixturePaths,
  turnResults,
  nodeBin,
  completedCommandItems,
  finalObservation,
  treeDeltas,
}) {
  if (!fixturePaths.captureWrapper) return null;
  const turn = turnResults.at(-1);
  const matches = completedCommandItems(turn).filter((item) => {
    const tokens = exactCommandTokens(item.command);
    return Boolean(
      tokens &&
        tokens.length === 2 &&
        tokens[0] === nodeBin &&
        tokens[1] === fixturePaths.captureWrapper,
    );
  });
  const item = matches.length === 1 ? matches[0] : null;
  const envelope = item ? parseInstallCaptureEnvelope(item.aggregatedOutput) : null;
  return {
    matchingCommandCount: matches.length,
    commandItem: item,
    envelope,
    stderrJson: envelope ? exactJsonObject(envelope.stderr) : null,
    exactCommandSha256: envelope?.commandSha256 === fixturePaths.captureCommandSha256,
    wrapperUnchanged:
      fixturePaths.captureWrapperSha256 !== null &&
      fixturePaths.captureWrapperSha256 === finalObservation.captureWrapperSha256,
    targetChangedPaths: treeDeltas.target,
    outsideChangedPaths: treeDeltas.outside,
    evaluatorChangedPaths: treeDeltas.evaluator,
  };
}
