import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { sameCanonicalPath } from './host.mjs';
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
      invocation.payload.value?.source === 'chat' &&
      String(invocation.payload.value?.content ?? '').includes(acceptance) &&
      outputCompatible,
  );
}

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

export function profileEntriesAreIdentical(before, after) {
  const left = profileEntryLines(before);
  const right = profileEntryLines(after);
  return (
    left.size === right.size &&
    [...left].every(([key, line]) => right.get(key) === line)
  );
}

export function profileEntryMutationIsExact(
  before,
  after,
  { removedKeys = [], addedKeys = [] },
) {
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
    expected.size === actual.size &&
    [...expected].every(([key, line]) => actual.get(key) === line)
  );
}

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
  return !invocations.some(
    (item) => item?.turn === turn && item?.action === 'reconcile-profile',
  );
}

export function memoryPayloadOutputIsCompatible(
  output,
  { kind, actions, allowUnobserved = false },
) {
  if (output === null || output === undefined) return allowUnobserved;
  return (
    output.version === 1 &&
    output.kind === kind &&
    new Set(actions).has(output.action)
  );
}

export function textContainsExactVerifierCommand(evidence, { script, target }) {
  const text = String(evidence ?? '').replaceAll('`', ' ').trim();
  const escape = (value) => String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!text || !script || !target) return false;
  const commandPattern = new RegExp(
    `(?:^|\\s|["'(])(?<command>(?:node|\\/[^\\s"'()]+\\/node)\\s+${escape(script)}\\s+${escape(target)})(?=$|\\s|["'),.;])`,
    'giu',
  );
  for (const match of text.matchAll(commandPattern)) {
    const command = match.groups?.command;
    if (!command) continue;
    const commandOffset = match[0].lastIndexOf(command);
    const commandStart = (match.index ?? 0) + commandOffset;
    const prefix = text.slice(Math.max(0, commandStart - 80), commandStart);
    const negated = /(?:\b(?:do not|don't|never|must not|should not|cannot|can't)\s+(?:run|execute|use|invoke)(?:\s+(?:the\s+)?(?:command|verifier|script))?(?:\s+with)?|(?:不要|不得|禁止|勿)\s*(?:运行|执行|使用|调用)?)\s*$/iu.test(prefix);
    const nestedRunner = /\b(?:python\d*|ruby|perl)\s*$/iu.test(prefix);
    if (!negated && !nestedRunner) return true;
  }
  return false;
}

export function verificationEvidenceProvesSuccessfulCommand(
  evidence,
  { script, target },
) {
  const text = String(evidence ?? '').replaceAll('`', ' ').trim();
  if (!text || !script || !target) return false;
  const successPattern =
    /\b(?:exit(?:ed)?(?:\s+code)?|status)\s*[:=]?\s*0\b|\bpass(?:ed)?\b|通过|成功/iu;
  const failurePattern =
    /\b(?:exit(?:ed)?(?:\s+code)?|status)\s*[:=]?\s*[1-9]\d*\b|\b(?:fail(?:ed|ure)?|error)\b|失败|错误/iu;
  return (
    textContainsExactVerifierCommand(text, { script, target }) &&
    successPattern.test(text) &&
    !failurePattern.test(text)
  );
}

export function compactionHandoffVerificationIsCurrent({
  payloadValue,
  persistedVerification,
  previousVerification,
  expectedVerifier,
  previousProjectTree,
  currentProjectTree,
}) {
  if (!payloadValue || typeof payloadValue !== 'object' || Array.isArray(payloadValue)) {
    return false;
  }
  if (
    !verificationEvidenceProvesSuccessfulCommand(
      persistedVerification,
      expectedVerifier,
    )
  ) {
    return false;
  }
  const relatedPaths = [expectedVerifier?.script, expectedVerifier?.target];
  if (
    relatedPaths.some((path) => {
      if (!path) return true;
      const previous = previousProjectTree?.entries?.[path];
      const current = currentProjectTree?.entries?.[path];
      return (
        previous?.type !== 'file' ||
        current?.type !== 'file' ||
        JSON.stringify(previous) !== JSON.stringify(current)
      );
    })
  ) {
    return false;
  }
  if (Object.hasOwn(payloadValue, 'verification')) {
    return verificationEvidenceProvesSuccessfulCommand(
      payloadValue.verification,
      expectedVerifier,
    );
  }
  return (
    verificationEvidenceProvesSuccessfulCommand(
      previousVerification,
      expectedVerifier,
    ) &&
    String(persistedVerification).trim() === String(previousVerification).trim()
  );
}

export function handoffPayloadProvesClearedOpen(invocation, expectedVerifier) {
  const payload = invocation?.payload;
  const value = payload?.value;
  return Boolean(
    payload?.ok === true &&
      value &&
      typeof value === 'object' &&
      value.clearOpen === true &&
      !Object.hasOwn(value, 'open') &&
      verificationEvidenceProvesSuccessfulCommand(value.verification, expectedVerifier),
  );
}

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
