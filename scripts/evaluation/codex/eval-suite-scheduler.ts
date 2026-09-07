import {
  type HostEvalRunnerOptions,
  type HostEvalScenarioResult,
  runHostEvalScenarios,
} from '../planning/eval-runner.js';

export type SuiteStatus = 'passed' | 'failed' | 'inconclusive';

export function summarizeSuiteResults(
  requiredIds: string[],
  results: HostEvalScenarioResult[],
): SuiteStatus {
  if (requiredIds.length === 0) return 'inconclusive';
  const ids = results.map((result) => result.scenarioId);
  if (new Set(ids).size !== ids.length || ids.some((id) => !requiredIds.includes(id)))
    return 'failed';
  if (
    results.some(
      (result) => result.outcome === 'behavior-failed' || result.outcome === 'evaluator-failed',
    )
  )
    return 'failed';
  if (ids.length !== requiredIds.length || requiredIds.some((id) => !ids.includes(id)))
    return 'inconclusive';
  return results.every(
    (result) =>
      result.outcome === 'passed' && result.termination === 'completed' && result.attempts >= 1,
  )
    ? 'passed'
    : 'inconclusive';
}

export async function runEvaluationSuite(
  options: HostEvalRunnerOptions & { requiredIds: string[] },
) {
  if (
    options.requiredIds.length === 0 ||
    options.scenarioIds.length !== options.requiredIds.length ||
    options.requiredIds.some((id, index) => options.scenarioIds[index] !== id)
  ) {
    throw new Error('Evaluation suite must contain the complete ordered scenario registry');
  }
  return runHostEvalScenarios(options);
}
