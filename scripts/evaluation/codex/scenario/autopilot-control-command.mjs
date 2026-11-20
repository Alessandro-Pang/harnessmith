import { isAbsolute, resolve } from 'node:path';
import { exactCommandTokens, sameCanonicalPath } from '../eval-codex-support.mjs';

/**
 * @param {import('./assertion-types.mjs').AssertionContext} context
 * @param {import('../support/types.mjs').CommandEvidence} item
 * @param {string[]} expected
 */
export function profileControlCommandMatches(context, item, expected) {
  const { repo, nodeBin, harnessBin, exactJsonObject } = context;
  const tokens = exactCommandTokens(item.command);
  const output = exactJsonObject(item.aggregatedOutput);
  return Boolean(
    tokens &&
      tokens.length === expected.length + 2 &&
      (tokens[0] === nodeBin || tokens[0] === 'node') &&
      sameCanonicalPath(
        isAbsolute(tokens[1]) ? resolve(tokens[1]) : resolve(repo, tokens[1]),
        harnessBin(),
      ) &&
      expected.every((token, index) => tokens[index + 2] === token) &&
      item.exitCode === 0 &&
      output?.version === 1 &&
      output?.kind === 'profile' &&
      output?.action === 'updated',
  );
}
