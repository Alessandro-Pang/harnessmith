import { checkpointIdempotencyIsProven, sanitizeAndBoundArtifact } from '../eval-codex-support.mjs';
import { auditScenarioBoundaries } from './assertion-boundary-audit.mjs';
import {
  collectChangedPaths,
  createRoutingEvidence,
  createTurnSelectors,
} from './assertion-runtime.mjs';
import { collectScenarioToolActions } from './assertion-tool-actions.mjs';

/**
 * @param {import('./execution-types.mjs').ScenarioExecutionContext} context
 * @param {ReturnType<typeof import('./execution-setup.mjs').createScenarioServices>} services
 * @param {ReturnType<typeof import('./execution-setup.mjs').initializeScenario>} baseline
 * @param {Awaited<ReturnType<typeof import('./execution-turns.mjs').executeScenarioTurns>>} turns
 * @param {ReturnType<typeof import('./execution-artifacts.mjs').createRunArtifacts>} artifacts
 */
export async function evaluateRunAssertions(context, services, baseline, turns, artifacts) {
  const changed = collectChangedPaths(context, services, turns, artifacts);
  const selectors = createTurnSelectors(turns, services, changed.changedPaths);
  const routing = createRoutingEvidence(context, services, turns);
  const rawToolActionDescriptors = collectScenarioToolActions(context, services, turns, artifacts);
  const audit = auditScenarioBoundaries(context, services, baseline, turns, artifacts);
  const artifact = artifacts.observationArtifact;
  artifact.routineAnnouncementEvidence = routing.routineAnnouncementEvidence;
  artifact.permissionReviewEvidence = routing.permissionReviewEvidence;
  artifact.explicitProfileControlRoutingViolations =
    routing.explicitProfileControlRoutingViolations;
  const assertionContext = {
    ...context,
    ...services,
    ...baseline,
    ...turns,
    ...artifacts,
    ...changed,
    ...selectors,
    ...routing,
    ...audit,
    checkpointIdempotencyIsProven,
    sanitizeAndBoundArtifact,
    asksRoutineMemoryPermission: null,
  };
  const { evaluateScenarioBranches } = await import('../scenario-assertions.mjs');
  const evaluation = evaluateScenarioBranches(assertionContext);
  applyCompletionFailures(context, turns, artifacts, evaluation);
  return { ...evaluation, ...changed, ...audit, rawToolActionDescriptors };
}

/**
 * @param {import('./execution-types.mjs').ScenarioExecutionContext} context
 * @param {Awaited<ReturnType<typeof import('./execution-turns.mjs').executeScenarioTurns>>} turns
 * @param {ReturnType<typeof import('./execution-artifacts.mjs').createRunArtifacts>} artifacts
 * @param {{ passValues: import('../support/types.mjs').AssertionValue[], forbiddenValues: import('../support/types.mjs').AssertionValue[], details: string[] }} evaluation
 */
function applyCompletionFailures(context, turns, artifacts, evaluation) {
  if (!turns.everyTurnCompleted) {
    evaluation.passValues = context.scenario.pass.map(() => false);
    evaluation.forbiddenValues = context.scenario.forbidden.map(() => false);
    evaluation.details.push(
      'Scenario assertions are unproven because at least one Host turn is incomplete.',
    );
  }
  for (const turn of turns.turnResults.filter((item) => !item.completion.completed)) {
    evaluation.details.push(
      `Host turn ${turn.label} incomplete: ${turn.completion.reasons.join('; ') || 'unknown completion failure'}`,
    );
  }
  if (artifacts.transcriptState.truncated) {
    evaluation.details.push(
      `Transcript exceeded the evidence budget; full sanitized SHA-256 is ${artifacts.transcriptState.fullSanitizedSha256}.`,
    );
  }
  if (artifacts.diffState.truncated) {
    evaluation.details.push(
      `Filesystem diff exceeded the evidence budget; full sanitized SHA-256 is ${artifacts.diffState.fullSanitizedSha256}.`,
    );
  }
  artifacts.observationArtifact.assertionResults = {
    pass: evaluation.passValues,
    forbidden: evaluation.forbiddenValues,
  };
  artifacts.observationArtifact.evaluatorErrors = [...new Set(context.evaluatorErrors)];
}
