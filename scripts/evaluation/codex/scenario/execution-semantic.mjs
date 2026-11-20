import { join } from 'node:path';

/**
 * @param {import('./execution-types.mjs').ScenarioExecutionContext} context
 * @param {Awaited<ReturnType<typeof import('./execution-turns.mjs').executeScenarioTurns>>} turns
 * @param {ReturnType<typeof import('./execution-artifacts.mjs').createRunArtifacts>} artifacts
 * @param {{ passValues: import('../support/types.mjs').AssertionValue[], forbiddenValues: import('../support/types.mjs').AssertionValue[], details: string[] }} evaluation
 * @param {string} observationsText
 */
export async function reviewScenarioAssertions(
  context,
  turns,
  artifacts,
  evaluation,
  observationsText,
) {
  const artifact = artifacts.observationArtifact;
  /** @type {import('../support/types.mjs').SemanticReviewResult | null} */
  let semanticReviewResult = null;
  if (
    artifact.semanticReviewRequests?.length &&
    turns.everyTurnCompleted &&
    artifacts.evidenceComplete
  ) {
    semanticReviewResult = await requestSemanticReview(
      context,
      artifacts,
      evaluation,
      observationsText,
    );
  } else if (artifact.semanticReviewRequests?.length) {
    semanticReviewResult = {
      outcome: 'inconclusive',
      decisions: [],
      transport: 'inconclusive',
      errors: ['semantic review requires complete Host and evidence'],
    };
  }
  if (semanticReviewResult) artifact.semanticReviewResult = semanticReviewResult;
  artifact.assertionResults = {
    pass: evaluation.passValues,
    forbidden: evaluation.forbiddenValues,
  };
  observationsText = `${JSON.stringify(artifact, null, 2)}\n`;
  if (Buffer.byteLength(observationsText) >= 8 * 1024 * 1024) {
    artifacts.evidenceComplete = false;
    observationsText = `${JSON.stringify({ evidenceComplete: false, error: 'semantic review enlarged observations beyond hard limit' }, null, 2)}\n`;
  }
  return { semanticReviewResult, observationsText };
}

/**
 * @param {import('./execution-types.mjs').ScenarioExecutionContext} context
 * @param {ReturnType<typeof import('./execution-artifacts.mjs').createRunArtifacts>} artifacts
 * @param {{ passValues: import('../support/types.mjs').AssertionValue[], forbiddenValues: import('../support/types.mjs').AssertionValue[], details: string[] }} evaluation
 * @param {string} observationsText
 */
async function requestSemanticReview(context, artifacts, evaluation, observationsText) {
  const requests = artifacts.observationArtifact.semanticReviewRequests ?? [];
  try {
    const { runSemanticReview } = await import('../eval-semantic-review.ts');
    const criteria = requests.map((request) => ({
      criterionId: request.assertionId,
      criterion: request.criterion,
      task: context.scenarioId,
      evidenceRefs: ['transcript', 'observations', 'filesystem-diff'],
    }));
    const result = await runSemanticReview({
      criteria,
      evidence: [
        { ref: 'transcript', content: artifacts.transcript },
        { ref: 'observations', content: observationsText },
        { ref: 'filesystem-diff', content: artifacts.diffArtifact },
      ],
      workspace: context.repo,
      model: context.model,
      outputFile: join(context.recordDir, 'semantic-review.json'),
    });
    applySemanticDecisions(result, evaluation);
    evaluation.details.push(
      `semantic-review=${result.outcome}; decisions=${result.decisions.length}; errors=${result.errors.length}`,
    );
    return result;
  } catch (error) {
    evaluation.details.push('semantic-review=inconclusive; judge unavailable');
    return {
      outcome: 'inconclusive',
      decisions: [],
      transport: 'inconclusive',
      errors: [`semantic judge unavailable: ${String(error)}`],
    };
  }
}

/**
 * @param {import('../support/types.mjs').SemanticReviewResult} result
 * @param {{ passValues: import('../support/types.mjs').AssertionValue[], forbiddenValues: import('../support/types.mjs').AssertionValue[] }} evaluation
 */
function applySemanticDecisions(result, evaluation) {
  const decisions = new Map(result.decisions.map((decision) => [decision.criterionId, decision]));
  for (const [index, value] of evaluation.passValues.entries()) {
    const decision = decisions.get(`pass-${index + 1}`);
    if (value === null && decision?.status === 'passed') evaluation.passValues[index] = true;
    if (value === null && decision?.status === 'failed') evaluation.passValues[index] = false;
  }
  for (const [index, value] of evaluation.forbiddenValues.entries()) {
    const decision = decisions.get(`forbidden-${index + 1}`);
    if (value === null && decision?.status === 'passed') evaluation.forbiddenValues[index] = true;
    if (value === null && decision?.status === 'failed') evaluation.forbiddenValues[index] = false;
  }
}
