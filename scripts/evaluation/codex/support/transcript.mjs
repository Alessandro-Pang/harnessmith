import { createHash } from 'node:crypto';

/**
 * @param {unknown} value
 * @returns {import('./types.mjs').CodexEvent | null}
 */
function codexEvent(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = Object.fromEntries(Object.entries(value));
  /** @type {import('./types.mjs').CodexEvent} */
  const event = { ...source };
  if (typeof source.type === 'string') event.type = source.type;
  if (typeof source.thread_id === 'string') event.thread_id = source.thread_id;
  if (source.item && typeof source.item === 'object' && !Array.isArray(source.item)) {
    const item = Object.fromEntries(Object.entries(source.item));
    event.item = {
      ...item,
      ...(typeof item.type === 'string' ? { type: item.type } : {}),
      ...(typeof item.command === 'string' ? { command: item.command } : {}),
      ...(typeof item.aggregated_output === 'string'
        ? { aggregated_output: item.aggregated_output }
        : {}),
      ...(typeof item.exit_code === 'number' || item.exit_code === null
        ? { exit_code: item.exit_code }
        : {}),
      ...(typeof item.status === 'string' ? { status: item.status } : {}),
      ...(typeof item.text === 'string' ? { text: item.text } : {}),
      ...(typeof item.path === 'string' ? { path: item.path } : {}),
      ...(typeof item.file_path === 'string' ? { file_path: item.file_path } : {}),
      ...(typeof item.target === 'string' ? { target: item.target } : {}),
    };
  }
  if (source.usage && typeof source.usage === 'object' && !Array.isArray(source.usage)) {
    const usage = Object.fromEntries(Object.entries(source.usage));
    if (typeof usage.input_tokens === 'number') {
      event.usage = { input_tokens: usage.input_tokens };
    }
  }
  return event;
}

/** @param {unknown} stdout */
export function parseJsonlEvidence(stdout) {
  /** @type {import('./types.mjs').CodexEvent[]} */
  const events = [];
  /** @type {{ lineNumber: number, sha256: string }[]} */
  const malformed = [];
  let malformedCount = 0;
  for (const [index, line] of String(stdout ?? '')
    .split(/\r?\n/)
    .entries()) {
    if (!line.trim()) continue;
    try {
      const event = codexEvent(JSON.parse(line));
      if (event) events.push(event);
    } catch {
      malformedCount += 1;
      if (malformed.length < 128) {
        malformed.push({
          lineNumber: index + 1,
          sha256: createHash('sha256').update(line).digest('hex'),
        });
      }
    }
  }
  return {
    events,
    malformed,
    malformedCount,
    malformedExceeded: malformedCount > malformed.length,
  };
}

/** @param {unknown} stdout */
export function jsonlEvents(stdout) {
  return parseJsonlEvidence(stdout).events;
}

/** @param {unknown} stdout */
export function visibleAgentMessages(stdout) {
  return jsonlEvents(stdout).flatMap((event) => {
    if (event.type !== 'item.completed' || event.item?.type !== 'agent_message') return [];
    const message = typeof event.item.text === 'string' ? event.item.text.trim() : '';
    return message ? [message] : [];
  });
}

/**
 * Applies the explicit semantic-review ledger to assertion values.
 * `null` means that no response prose is authoritative evidence.
 *
 * @param {import('./types.mjs').AssertionEvaluationInput} input
 * @returns {import('./types.mjs').AssertionEvaluation}
 */
export function evaluateScenarioAssertions({ scenario, passes, forbiddens }) {
  const passList = Array.isArray(passes) ? passes : [];
  const forbiddenList = Array.isArray(forbiddens) ? forbiddens : [];
  if (
    !scenario ||
    !Array.isArray(scenario.pass) ||
    !Array.isArray(scenario.forbidden) ||
    passList.length !== scenario.pass.length ||
    forbiddenList.length !== scenario.forbidden.length
  ) {
    throw new Error('semantic assertion mapping mismatch');
  }
  const semanticIds = new Set(
    Array.isArray(scenario.semanticReviewAssertions)
      ? scenario.semanticReviewAssertions.map(String)
      : [],
  );
  const knownIds = new Set([
    ...scenario.pass.map((_, index) => `pass-${index + 1}`),
    ...scenario.forbidden.map((_, index) => `forbidden-${index + 1}`),
  ]);
  for (const id of semanticIds) {
    if (!knownIds.has(id)) throw new Error(`unknown semantic assertion: ${id}`);
  }
  /**
   * @param {import('./types.mjs').AssertionValue[]} list
   * @param {string} prefix
   */
  const values = (list, prefix) =>
    list.map((value, index) => {
      const id = `${prefix}-${index + 1}`;
      if (value === null && !semanticIds.has(id)) {
        throw new Error(`unregistered semantic requirement: ${id}`);
      }
      return semanticIds.has(id) && value === true ? null : value;
    });
  const passValues = values(passList, 'pass');
  const forbiddenValues = values(forbiddenList, 'forbidden');
  const semanticReviewRequests = [...semanticIds].map((assertionId) => {
    const pass = assertionId.startsWith('pass-');
    const index = Number(assertionId.slice(pass ? 5 : 10)) - 1;
    return {
      assertionId,
      criterion: pass ? scenario.pass[index] : scenario.forbidden[index],
      reason:
        'natural-language criterion requires semantic review; no response regex is authoritative',
    };
  });
  return {
    passValues,
    forbiddenValues,
    semanticReviewRequests,
    mechanicalFailure: [...passValues, ...forbiddenValues].some((value) => value === false),
  };
}

export { evaluateCodexTurnCompletion } from './codex-completion.ts';

/** @param {import('./types.mjs').HostTurn[]} turnResults */
export function classifyCodexScenarioHostFailures(turnResults) {
  const transportFailed = turnResults.some(
    (turn) =>
      turn?.result?.captureKind === 'transport-failure' ||
      turn?.completion?.transportFailure === true,
  );
  const hostEvaluatorFailed = turnResults.some(
    (turn) =>
      turn?.completion?.transportFailure !== true &&
      (turn?.result?.captureKind === 'evaluator-failure' ||
        (turn?.result?.captureKind !== 'transport-failure' && Boolean(turn?.result?.error))),
  );
  return { transportFailed, hostEvaluatorFailed };
}
