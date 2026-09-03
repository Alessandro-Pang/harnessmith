import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import type { HostEvalAttempt, HostEvalAttemptResult } from '../planning/eval-runner.js';
import { repositoryRoot } from '../records/eval-fingerprint.js';

type ScenarioExecutorOptions = {
  packageArtifact: string;
  model: string;
  scenarioBudgetMs: number;
  matrixBudgetMs: number;
  maxOutputBytes: number;
  outputDir: string;
  hostVersion: string;
  scenarioEntry?: string;
};

export function createScenarioExecutor(
  options: ScenarioExecutorOptions,
): (attempt: HostEvalAttempt) => Promise<HostEvalAttemptResult> {
  const scenarioEntry =
    options.scenarioEntry ?? fileURLToPath(new URL('./eval-codex-scenario.mjs', import.meta.url));
  return async (attempt) => {
    try {
      const result = await execa(
        process.execPath,
        ['--import', 'tsx', scenarioEntry, attempt.scenarioId],
        {
          cwd: repositoryRoot,
          env: {
            ...process.env,
            HARNESS_RELEASE_ARTIFACT: options.packageArtifact,
            HARNESS_EVAL_OUTPUT_DIR: options.outputDir,
            HARNESS_EVAL_MODEL: options.model,
            HARNESS_EVAL_ATTEMPT: String(attempt.attempt),
            HARNESS_EVAL_MAX_ATTEMPTS: String(attempt.maxAttempts),
            HARNESS_EVAL_SCENARIO_BUDGET_MS: String(options.scenarioBudgetMs),
            HARNESS_EVAL_MATRIX_BUDGET_MS: String(options.matrixBudgetMs),
            HARNESS_EVAL_MAX_OUTPUT_BYTES: String(options.maxOutputBytes),
            HARNESS_EVAL_HOST_VERSION: options.hostVersion,
          },
          cancelSignal: attempt.signal,
          forceKillAfterDelay: 1_000,
          killDescendants: true,
          maxBuffer: options.maxOutputBytes,
          reject: false,
        },
      );
      if (result.isCanceled) {
        return { outcome: 'infra-inconclusive', termination: 'transport-failure' };
      }
      if (result.exitCode !== 0) {
        return { outcome: 'evaluator-failed', termination: 'evaluator-failure' };
      }
      const summary = JSON.parse(result.stdout.trim().split(/\r?\n/u).at(-1) ?? '{}') as {
        scenarioId?: string;
        outcome?: string;
        termination?: string;
      };
      if (summary.scenarioId !== attempt.scenarioId) {
        return { outcome: 'evaluator-failed', termination: 'evaluator-failure' };
      }
      if (
        summary.termination === 'completed' &&
        (summary.outcome === 'passed' || summary.outcome === 'behavior-failed')
      ) {
        return { outcome: summary.outcome, termination: 'completed' };
      }
      if (summary.outcome === 'infra-inconclusive' && summary.termination === 'transport-failure') {
        return { outcome: 'infra-inconclusive', termination: 'transport-failure' };
      }
      return { outcome: 'evaluator-failed', termination: 'evaluator-failure' };
    } catch {
      return attempt.signal.aborted
        ? { outcome: 'infra-inconclusive', termination: 'transport-failure' }
        : { outcome: 'evaluator-failed', termination: 'evaluator-failure' };
    }
  };
}
