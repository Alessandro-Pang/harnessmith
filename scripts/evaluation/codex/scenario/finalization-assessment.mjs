import { classifyCodexScenarioHostFailures } from '../eval-codex-support.mjs';
import { resolveScenarioOutcome } from './finalization-logic.mjs';

/** @param {import('./finalization-types.mjs').FinalizationContext} context */
export function buildScenarioAssessment(context) {
  const {
    everyTurnCompleted,
    evaluatorErrors,
    treeErrors,
    boundaryViolations,
    passValues,
    forbiddenValues,
    semanticReviewResult,
    turnResults,
    scenarioId,
    host,
    scenario,
    details,
    sanitizeAndBoundArtifact,
  } = context;
  let { evidenceComplete } = context;
  const evaluatorHealthy = evaluatorErrors.length === 0 && treeErrors.length === 0;
  const boundarySafe = boundaryViolations.length === 0;
  const finalizedForbiddenValues = forbiddenValues.map((value) => (boundarySafe ? value : false));
  if (!boundarySafe) {
    details.push(`destructive-or-remote-boundary-violations=${boundaryViolations.length}`);
  }
  const { transportFailed, hostEvaluatorFailed } = classifyCodexScenarioHostFailures(turnResults);
  const semanticPending = Boolean(
    semanticReviewResult &&
      (semanticReviewResult.outcome === 'inconclusive' ||
        semanticReviewResult.decisions.some((decision) => decision.status === 'inconclusive')),
  );
  const resolution = resolveScenarioOutcome({
    everyTurnCompleted,
    evidenceComplete,
    evaluatorHealthy,
    boundarySafe,
    passValues,
    forbiddenValues: finalizedForbiddenValues,
    transportFailed,
    hostEvaluatorFailed,
    semanticPending,
  });
  let { outcome, termination, passed } = resolution;
  const { checks } = resolution;
  const render = () =>
    `Scenario ${scenarioId} on ${host}: ${outcome}\nHost turns: ${everyTurnCompleted}\nEvidence complete: ${evidenceComplete}\nEvaluator healthy: ${evaluatorHealthy}\nPass assertions:\n${scenario.pass.map((description, index) => `- pass-${index + 1}=${passValues[index]}: ${description}`).join('\n')}\nForbidden-action assertions:\n${scenario.forbidden.map((description, index) => `- forbidden-${index + 1}=${finalizedForbiddenValues[index]}: ${description}`).join('\n')}\n${details.length ? `Notes:\n${details.map((note) => `- ${note}`).join('\n')}\n` : ''}`;
  let assessmentState = sanitizeAndBoundArtifact(render(), 2 * 1024 * 1024);
  if (assessmentState.truncated) {
    evidenceComplete = false;
    checks[1] = false;
    outcome = 'evaluator-failed';
    termination = 'evaluator-failure';
    passed = false;
    assessmentState = sanitizeAndBoundArtifact(
      `${render()}\nAssessment detail was truncated; full sanitized SHA-256: ${assessmentState.fullSanitizedSha256}.\n`,
      2 * 1024 * 1024,
    );
  }
  return {
    assessmentState,
    checks,
    evidenceComplete,
    finalizedForbiddenValues,
    hostEvaluatorFailed,
    outcome,
    passed,
    termination,
    transportFailed,
  };
}
