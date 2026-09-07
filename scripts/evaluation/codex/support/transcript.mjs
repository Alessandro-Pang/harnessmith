import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
export function parseJsonlEvidence(stdout) {
  const events = [];
  const malformed = [];
  let malformedCount = 0;
  for (const [index, line] of String(stdout ?? '').split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
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

export function jsonlEvents(stdout) {
  return parseJsonlEvidence(stdout).events;
}

export function visibleAgentMessages(stdout) {
  return jsonlEvents(stdout).flatMap((event) => {
    if (event?.type !== 'item.completed' || event?.item?.type !== 'agent_message') return [];
    const message = typeof event.item.text === 'string' ? event.item.text.trim() : '';
    return message ? [message] : [];
  });
}

/**
 * Applies the explicit semantic-review ledger to assertion values.
 * `null` means that no response prose is authoritative evidence.
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
  ) throw new Error('semantic assertion mapping mismatch');
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
  const values = (list, prefix) => list.map((value, index) => {
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
      reason: 'natural-language criterion requires semantic review; no response regex is authoritative',
    };
  });
  return {
    passValues,
    forbiddenValues,
    semanticReviewRequests,
    mechanicalFailure: [...passValues, ...forbiddenValues].some((value) => value === false),
  };
}

export function evaluateCodexTurnCompletion(result, { requireAgentCompletion = true } = {}) {
  const events = jsonlEvents(result?.stdout);
  const hasTurnCompleted = events.some((event) => event?.type === 'turn.completed');
  const hasAgentCompletion = events.some(
    (event) =>
      event?.type === 'item.completed' &&
      event?.item?.type === 'agent_message' &&
      typeof event.item.text === 'string',
  );
  const transportText = `${result?.error ?? ''}\n${result?.stderr ?? ''}\n${result?.stdout ?? ''}`;
  const transientHostFailure = events.some(
    (event) =>
      event?.type === 'turn.failed' &&
      /selected model is at capacity/i.test(String(event?.error?.message ?? '')),
  );
  const transportFailure =
    (transientHostFailure ||
      /ETIMEDOUT|timed? out|ENOTFOUND|EAI_AGAIN|ECONN(?:RESET|REFUSED)|DNS|network is unreachable|stream disconnected|connection (?:closed|lost)/i.test(
        transportText,
      )) &&
    (!hasTurnCompleted || (requireAgentCompletion && !hasAgentCompletion));
  const reasons = [];
  if (result?.status !== 0) reasons.push(`status=${String(result?.status)}`);
  if (result?.signal) reasons.push(`signal=${String(result.signal)}`);
  if (result?.error) reasons.push(`error=${String(result.error)}`);
  if (!hasTurnCompleted) reasons.push('missing turn.completed');
  if (requireAgentCompletion && !hasAgentCompletion) reasons.push('missing agent_message completion');
  if (transportFailure) reasons.push('transport failure without completion evidence');
  return {
    completed:
      result?.status === 0 &&
      !result?.signal &&
      !result?.error &&
      hasTurnCompleted &&
      (!requireAgentCompletion || hasAgentCompletion) &&
      !transportFailure,
    transportFailure,
    hasTurnCompleted,
    hasAgentCompletion,
    reasons,
  };
}

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
