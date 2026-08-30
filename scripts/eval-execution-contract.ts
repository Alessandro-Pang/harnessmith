import { relative } from 'node:path';
import type { RunRecord } from './eval-artifacts.js';
import { repositoryRoot } from './eval-fingerprint.js';

export function verifyExecutionClassification(path: string, record: RunRecord): void {
  const label = relative(repositoryRoot, path);
  const { execution, verdict } = record;
  if (execution.attempt > execution.maxAttempts) {
    throw new Error(`${label} execution attempt exceeds maxAttempts`);
  }
  if (execution.elapsedMs > execution.scenarioBudgetMs) {
    throw new Error(`${label} execution elapsedMs exceeds scenarioBudgetMs`);
  }
  if (execution.scenarioBudgetMs > execution.matrixBudgetMs) {
    throw new Error(`${label} scenarioBudgetMs exceeds matrixBudgetMs`);
  }
  if (execution.transportFailures > execution.attempt) {
    throw new Error(`${label} transportFailures exceeds completed attempts`);
  }
  const infrastructureTermination = new Set([
    'transport-failure',
    'scenario-budget-exhausted',
    'circuit-open',
  ]);
  if (infrastructureTermination.has(execution.termination)) {
    if (verdict.outcome !== 'infra-inconclusive') {
      throw new Error(`${label} ${execution.termination} must be infra-inconclusive`);
    }
  } else if (execution.termination === 'evaluator-failure') {
    if (verdict.outcome !== 'evaluator-failed') {
      throw new Error(`${label} evaluator-failure must be evaluator-failed`);
    }
  } else if (!['passed', 'behavior-failed'].includes(verdict.outcome)) {
    throw new Error(`${label} completed execution must be passed or behavior-failed`);
  }
  if (
    execution.termination === 'circuit-open' &&
    (execution.attempt !== 2 || execution.transportFailures !== 2)
  ) {
    throw new Error(`${label} circuit-open requires two attempts and two transport failures`);
  }
}
