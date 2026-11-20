import { sameCanonicalPath } from './host.mjs';
import { memoryPayloadOutputIsCompatible } from './memory-output.mjs';

/**
 * @param {{ followCommandExact: boolean, repeatedCommandExact: boolean, samePayloadPath: boolean, samePayloadSha: boolean, followOutput: import('./types.mjs').MemoryPayloadOutput | null | undefined, followOutputObserved: boolean, repeatedOutput: import('./types.mjs').MemoryPayloadOutput | null | undefined, repeatedOutputObserved: boolean, expectedPath?: string, expectedReference?: string, preToFollowChanged: boolean, followToRepeatUnchanged: boolean, projectDigestUnchanged: boolean }} input
 */
export function checkpointIdempotencyIsProven({
  followCommandExact,
  repeatedCommandExact,
  samePayloadPath,
  samePayloadSha,
  followOutput,
  followOutputObserved,
  repeatedOutput,
  repeatedOutputObserved,
  expectedPath,
  expectedReference,
  preToFollowChanged,
  followToRepeatUnchanged,
  projectDigestUnchanged,
}) {
  const parsedFollowOutputObserved = Boolean(followOutput);
  if (Boolean(followOutputObserved) !== parsedFollowOutputObserved) return false;
  const parsedRepeatedOutputObserved = Boolean(repeatedOutput);
  if (Boolean(repeatedOutputObserved) !== parsedRepeatedOutputObserved) return false;
  const followOutputCompatible = memoryPayloadOutputIsCompatible(followOutput, {
    kind: 'episode',
    actions: ['created', 'updated'],
    allowUnobserved: !followOutputObserved,
  });
  const followIdentityCompatible =
    !followOutputObserved ||
    (sameCanonicalPath(followOutput?.path, expectedPath) &&
      followOutput?.reference === expectedReference);
  const repeatedOutputCompatible = repeatedOutputObserved
    ? Boolean(
        repeatedOutput?.version === 1 &&
          repeatedOutput?.action === 'unchanged' &&
          repeatedOutput?.kind === 'episode' &&
          sameCanonicalPath(repeatedOutput?.path, expectedPath) &&
          repeatedOutput?.reference === expectedReference,
      )
    : repeatedOutput == null;
  return Boolean(
    followCommandExact &&
      repeatedCommandExact &&
      samePayloadPath &&
      samePayloadSha &&
      followOutputCompatible &&
      followIdentityCompatible &&
      repeatedOutputCompatible &&
      preToFollowChanged &&
      followToRepeatUnchanged &&
      projectDigestUnchanged,
  );
}
