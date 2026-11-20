import { singleExactPayloadMutationAttempt } from './memory-commands.mjs';

export { checkpointIdempotencyIsProven } from './checkpoint-idempotency.mjs';
export { memoryPayloadOutputIsCompatible } from './memory-output.mjs';
export {
  compactionHandoffVerificationIsCurrent,
  handoffPayloadProvesClearedOpen,
  textContainsExactVerifierCommand,
  verificationEvidenceProvesSuccessfulCommand,
} from './memory-verification.mjs';

/**
 * @param {{ invocations: import('./types.mjs').PayloadInvocation[], invocation: import('./types.mjs').PayloadInvocation | null, acceptance: string, outputCompatible: boolean }} input
 */
export function typedInputCaptureIsProven({
  invocations,
  invocation,
  acceptance,
  outputCompatible,
}) {
  return Boolean(
    singleExactPayloadMutationAttempt(invocations, invocation, {
      turn: 'initial',
      action: 'capture-input',
    }) &&
      invocation?.payload?.value?.source === 'chat' &&
      String(invocation.payload.value?.content ?? '').includes(acceptance) &&
      outputCompatible,
  );
}

/** @param {unknown} content */
export function profileEntryLines(content) {
  return new Map(
    String(content ?? '')
      .split(/\r?\n/u)
      .flatMap((line) => {
        const match = line.match(/^- ([a-z0-9]+(?:[.-][a-z0-9]+)*) \|/u);
        return match ? [[match[1], line]] : [];
      }),
  );
}

/** @param {unknown} before @param {unknown} after */
export function profileEntriesAreIdentical(before, after) {
  const left = profileEntryLines(before);
  const right = profileEntryLines(after);
  return left.size === right.size && [...left].every(([key, line]) => right.get(key) === line);
}

/**
 * @param {unknown} before
 * @param {unknown} after
 * @param {{ removedKeys?: string[], addedKeys?: string[] }} changes
 */
export function profileEntryMutationIsExact(before, after, { removedKeys = [], addedKeys = [] }) {
  const expected = profileEntryLines(before);
  const actual = profileEntryLines(after);
  for (const key of removedKeys) {
    if (!expected.has(key)) return false;
    expected.delete(key);
  }
  for (const key of addedKeys) {
    if (expected.has(key)) return false;
    const line = actual.get(key);
    if (!line) return false;
    expected.set(key, line);
  }
  return (
    expected.size === actual.size && [...expected].every(([key, line]) => actual.get(key) === line)
  );
}

/**
 * @param {{ invocations: import('./types.mjs').PayloadInvocation[], turn: string, beforeProfileDigest?: string, afterProfileDigest?: string }} input
 */
export function pausedOrdinaryPreferenceStayedEphemeral({
  invocations,
  turn,
  beforeProfileDigest,
  afterProfileDigest,
}) {
  if (
    !Array.isArray(invocations) ||
    typeof beforeProfileDigest !== 'string' ||
    !beforeProfileDigest ||
    beforeProfileDigest !== afterProfileDigest
  ) {
    return false;
  }
  return !invocations.some((item) => item?.turn === turn && item?.action === 'reconcile-profile');
}
