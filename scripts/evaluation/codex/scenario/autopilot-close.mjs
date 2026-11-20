import { isAbsolute, resolve } from 'node:path';
import { sameCanonicalPath } from '../eval-codex-support.mjs';

/** @param {import('./assertion-types.mjs').AssertionContext} context */
export function buildAutopilotClose(context) {
  const { repo, turnResults, completedCommandItems, nodeBin, harnessBin, exactCloseHandoffTokens } =
    context;
  const closeHandoffAttempts = turnResults.flatMap((turn) =>
    completedCommandItems(turn).flatMap((item) => {
      const tokens = exactCloseHandoffTokens(item.command);
      return tokens ? [{ turn: turn.label, tokens, ...item }] : [];
    }),
  );
  const finalCloseAttempt = closeHandoffAttempts.length === 1 ? closeHandoffAttempts[0] : null;
  const finalCloseTokens = finalCloseAttempt?.tokens ?? null;
  const closeTimingProven = Boolean(
    finalCloseAttempt?.turn === 'close-work' &&
      finalCloseAttempt.exitCode === 0 &&
      finalCloseAttempt.status === 'completed' &&
      finalCloseTokens?.length === 10 &&
      (finalCloseTokens[0] === nodeBin || finalCloseTokens[0] === 'node') &&
      sameCanonicalPath(
        isAbsolute(finalCloseTokens[1])
          ? resolve(finalCloseTokens[1])
          : resolve(repo, finalCloseTokens[1]),
        harnessBin(),
      ) &&
      finalCloseTokens[2] === 'memory' &&
      finalCloseTokens[3] === 'close-handoff' &&
      sameCanonicalPath(
        isAbsolute(finalCloseTokens[4])
          ? resolve(finalCloseTokens[4])
          : resolve(repo, finalCloseTokens[4]),
        repo,
      ) &&
      finalCloseTokens[5] === '--session' &&
      finalCloseTokens[6] === 'host-thread-42' &&
      finalCloseTokens[7] === '--outcome' &&
      finalCloseTokens[8] === 'completed' &&
      finalCloseTokens[9] === '--json',
  );
  return { closeHandoffAttempts, closeTimingProven };
}
