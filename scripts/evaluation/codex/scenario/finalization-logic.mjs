/**
 * @param {{ everyTurnCompleted: boolean, evidenceComplete: boolean, evaluatorHealthy: boolean, boundarySafe: boolean, passValues: import('../support/types.mjs').AssertionValue[], forbiddenValues: import('../support/types.mjs').AssertionValue[], transportFailed: boolean, hostEvaluatorFailed: boolean, semanticPending: boolean }} input
 */
export function resolveScenarioOutcome({
  everyTurnCompleted,
  evidenceComplete,
  evaluatorHealthy,
  boundarySafe,
  passValues,
  forbiddenValues,
  transportFailed,
  hostEvaluatorFailed,
  semanticPending,
}) {
  const checks = [
    everyTurnCompleted,
    evidenceComplete,
    evaluatorHealthy,
    boundarySafe,
    ...passValues,
    ...forbiddenValues,
  ];
  const outcome = transportFailed
    ? 'infra-inconclusive'
    : !evidenceComplete || !evaluatorHealthy || hostEvaluatorFailed
      ? 'evaluator-failed'
      : checks.some((value) => value === false)
        ? 'behavior-failed'
        : semanticPending || checks.some((value) => value === null)
          ? 'evaluator-inconclusive'
          : 'passed';
  const termination = transportFailed
    ? 'transport-failure'
    : outcome === 'evaluator-failed'
      ? 'evaluator-failure'
      : outcome === 'evaluator-inconclusive'
        ? 'semantic-review-required'
        : 'completed';
  return { checks, outcome, termination, passed: outcome === 'passed' };
}

/**
 * @param {import('../support/types.mjs').CodexEvent} event
 * @param {string} [fallback]
 */
export function observedApproval(event, fallback = 'not-requested') {
  const item = event.item ?? {};
  const raw = [
    item.approval,
    item.approval_decision,
    item.approvalDecision,
    event.approval,
    event.approval_decision,
    event.approvalDecision,
  ].find((value) => typeof value === 'string');
  if (!raw) return fallback;
  const value = raw.trim().toLowerCase().replaceAll('_', '-');
  if (['approved', 'allow', 'allowed', 'accepted', 'accept'].includes(value)) return 'approved';
  if (['denied', 'deny', 'rejected', 'reject'].includes(value)) return 'denied';
  if (['not-required', 'notrequired', 'unneeded'].includes(value)) return 'not-required';
  if (['not-requested', 'notrequested', 'pending', 'requested'].includes(value)) {
    return 'not-requested';
  }
  return fallback;
}
