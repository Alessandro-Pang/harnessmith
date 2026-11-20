/** @param {unknown} value */
function escapeRegExp(value) {
  return String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * @param {unknown} evidence
 * @param {import('./types.mjs').Verifier} verifier
 */
export function textContainsExactVerifierCommand(evidence, { script, target }) {
  const text = String(evidence ?? '')
    .replaceAll('`', ' ')
    .trim();
  if (!text || !script || !target) return false;
  const commandPattern = new RegExp(
    `(?:^|\\s|["'(])(?<command>(?:node|\\/[^\\s"'()]+\\/node)\\s+${escapeRegExp(script)}\\s+${escapeRegExp(target)})(?=$|\\s|["'),.;])`,
    'giu',
  );
  for (const match of text.matchAll(commandPattern)) {
    const command = match.groups?.command;
    if (!command) continue;
    const commandOffset = match[0].lastIndexOf(command);
    const commandStart = (match.index ?? 0) + commandOffset;
    const prefix = text.slice(Math.max(0, commandStart - 80), commandStart);
    const negated =
      /(?:\b(?:do not|don't|never|must not|should not|cannot|can't)\s+(?:run|execute|use|invoke)(?:\s+(?:the\s+)?(?:command|verifier|script))?(?:\s+with)?|(?:不要|不得|禁止|勿)\s*(?:运行|执行|使用|调用)?)\s*$/iu.test(
        prefix,
      );
    const nestedRunner = /\b(?:python\d*|ruby|perl)\s*$/iu.test(prefix);
    if (!negated && !nestedRunner) return true;
  }
  return false;
}

/**
 * @param {unknown} evidence
 * @param {import('./types.mjs').Verifier} verifier
 */
export function verificationEvidenceProvesSuccessfulCommand(evidence, { script, target }) {
  const text = String(evidence ?? '')
    .replaceAll('`', ' ')
    .trim();
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

/**
 * @param {{ payloadValue: Record<string, unknown> | null | undefined, persistedVerification: unknown, previousVerification: unknown, expectedVerifier: import('./types.mjs').Verifier, previousProjectTree?: import('./types.mjs').RuntimeTreeSnapshot | null, currentProjectTree?: import('./types.mjs').RuntimeTreeSnapshot | null }} input
 */
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
  if (!verificationEvidenceProvesSuccessfulCommand(persistedVerification, expectedVerifier)) {
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
    return verificationEvidenceProvesSuccessfulCommand(payloadValue.verification, expectedVerifier);
  }
  return (
    verificationEvidenceProvesSuccessfulCommand(previousVerification, expectedVerifier) &&
    String(persistedVerification).trim() === String(previousVerification).trim()
  );
}

/**
 * @param {import('./types.mjs').HandoffInvocation | null | undefined} invocation
 * @param {import('./types.mjs').Verifier} expectedVerifier
 */
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
