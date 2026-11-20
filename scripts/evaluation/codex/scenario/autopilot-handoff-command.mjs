import { isAbsolute, resolve } from 'node:path';
import { exactCommandTokens, sameCanonicalPath } from '../eval-codex-support.mjs';

/** @param {import('./assertion-types.mjs').AssertionContext} context */
export function createHandoffCommandExact(context) {
  const { repo, nodeBin, harnessBin } = context;
  return (
    /** @type {import('../support/types.mjs').HandoffInvocation | null | undefined} */ item,
  ) =>
    Boolean(
      item &&
        (() => {
          const tokens = exactCommandTokens(item.command);
          return Boolean(
            tokens &&
              tokens.length === 8 &&
              (tokens[0] === nodeBin || tokens[0] === 'node') &&
              sameCanonicalPath(
                isAbsolute(tokens[1]) ? resolve(tokens[1]) : resolve(repo, tokens[1]),
                harnessBin(),
              ) &&
              tokens[2] === 'memory' &&
              tokens[3] === 'handoff' &&
              sameCanonicalPath(
                isAbsolute(tokens[4]) ? resolve(tokens[4]) : resolve(repo, tokens[4]),
                repo,
              ) &&
              tokens[5] === '--payload-file' &&
              sameCanonicalPath(
                isAbsolute(tokens[6]) ? resolve(tokens[6]) : resolve(repo, tokens[6]),
                item.resolvedPayloadPath,
              ) &&
              tokens[7] === '--json',
          );
        })() &&
        item.completed &&
        item.exitCode === 0,
    );
}
