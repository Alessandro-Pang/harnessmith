import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { HostEvalAttempt, HostEvalAttemptResult } from '../planning/eval-runner.js';
import { executeEvaluatorProcess } from './evaluator-process.js';

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
      const result = await executeEvaluatorProcess({
        entry: scenarioEntry,
        args: [attempt.scenarioId],
        outputDir: options.outputDir,
        attempt,
        packageArtifact: options.packageArtifact,
        model: options.model,
        hostVersion: options.hostVersion,
        scenarioBudgetMs: options.scenarioBudgetMs,
        matrixBudgetMs: options.matrixBudgetMs,
        maxOutputBytes: options.maxOutputBytes,
      });
      if (result.isCanceled) {
        return { outcome: 'infra-inconclusive', termination: 'transport-failure' };
      }
      if (result.exitCode !== 0) {
        writeFileSync(
          `${options.outputDir}/process-error.json`,
          `${JSON.stringify({ exitCode: result.exitCode, canceled: result.isCanceled, stdoutBytes: Buffer.byteLength(result.stdout), stderrBytes: Buffer.byteLength(result.stderr), stdoutSha256: createHash('sha256').update(result.stdout).digest('hex'), stderrSha256: createHash('sha256').update(result.stderr).digest('hex') }, null, 2)}\n`,
          { flag: 'wx' },
        );
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
      if (
        summary.outcome === 'evaluator-inconclusive' &&
        summary.termination === 'semantic-review-required'
      ) {
        return { outcome: 'evaluator-inconclusive', termination: 'semantic-review-required' };
      }
      return { outcome: 'evaluator-failed', termination: 'evaluator-failure' };
    } catch {
      return attempt.signal.aborted
        ? { outcome: 'infra-inconclusive', termination: 'transport-failure' }
        : { outcome: 'evaluator-failed', termination: 'evaluator-failure' };
    }
  };
}
