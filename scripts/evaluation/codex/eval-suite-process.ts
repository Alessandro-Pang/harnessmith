import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import type { HostEvalAttempt, HostEvalAttemptResult } from '../planning/eval-runner.js';
import { repositoryRoot } from '../records/eval-fingerprint.js';
import type { CodexMatrixOptions } from './eval-codex-options.js';
import { createScenarioExecutor } from './eval-codex-scenario-process.js';
import type { EvaluationCase } from './eval-suite-registry.js';

export function attemptDirectory(
  outputDir: string,
  entry: EvaluationCase,
  attempt: number,
): string {
  return join(outputDir, entry.family, entry.id.replaceAll(':', '--'), `attempt-${attempt}`);
}

export function classifiedOutcome(outcome: unknown): HostEvalAttemptResult {
  if (outcome === 'passed' || outcome === 'behavior-failed')
    return { outcome, termination: 'completed' };
  if (outcome === 'infra-inconclusive') return { outcome, termination: 'transport-failure' };
  if (outcome === 'evaluator-inconclusive')
    return { outcome, termination: 'semantic-review-required' };
  return { outcome: 'evaluator-failed', termination: 'evaluator-failure' };
}

export async function executeSuiteCase(
  options: CodexMatrixOptions & { hostVersion: string },
  entry: EvaluationCase,
  attempt: HostEvalAttempt,
): Promise<HostEvalAttemptResult> {
  const outputDir = attemptDirectory(options.outputDir, entry, attempt.attempt);
  mkdirSync(outputDir, { recursive: true });
  if (entry.family === 'behavior')
    return createScenarioExecutor({ ...options, outputDir })({
      ...attempt,
      scenarioId: entry.sourceId,
    });
  const scenarioEntry = fileURLToPath(
    new URL(
      entry.family === 'memory'
        ? './eval-codex-memory-scenario.mjs'
        : './eval-reasoning-process.ts',
      import.meta.url,
    ),
  );
  const result = await execa(
    process.execPath,
    ['--import', 'tsx', scenarioEntry, entry.sourceId, String(entry.promptVariant ?? 0)],
    {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        HARNESS_RELEASE_ARTIFACT: options.packageArtifact,
        HARNESS_EXPECTED_PACKAGE_SHA256: options.expectedPackageSha256,
        HARNESS_EVAL_MODEL: options.model,
        HARNESS_EVAL_HOST_VERSION: options.hostVersion,
        HARNESS_EVAL_OUTPUT_DIR: outputDir,
        HARNESS_EVAL_ATTEMPT: String(attempt.attempt),
        HARNESS_EVAL_MAX_ATTEMPTS: String(attempt.maxAttempts),
        HARNESS_EVAL_DEADLINE_MS: String(attempt.deadlineMs),
        HARNESS_EVAL_SCENARIO_BUDGET_MS: String(options.scenarioBudgetMs),
        HARNESS_EVAL_MATRIX_BUDGET_MS: String(options.matrixBudgetMs),
        HARNESS_EVAL_MAX_OUTPUT_BYTES: String(options.maxOutputBytes),
      },
      cancelSignal: attempt.signal,
      forceKillAfterDelay: 1000,
      killDescendants: true,
      maxBuffer: options.maxOutputBytes,
      reject: false,
    },
  );
  if (result.isCanceled) return { outcome: 'infra-inconclusive', termination: 'transport-failure' };
  if (result.exitCode !== 0) {
    // This file is diagnostic only; it can never satisfy a passing record requirement.
    writeFileSync(
      join(outputDir, 'process-error.json'),
      JSON.stringify({ exitCode: result.exitCode, outputLimit: result.isMaxBuffer === true }),
      { flag: 'wx' },
    );
    return { outcome: 'evaluator-failed', termination: 'evaluator-failure' };
  }
  try {
    const summary = JSON.parse(result.stdout.trim().split(/\r?\n/u).at(-1) ?? '{}') as {
      scenarioId?: string;
      variant?: number;
      outcome?: string;
    };
    if (
      summary.scenarioId !== entry.sourceId ||
      (entry.family === 'memory' && summary.variant !== entry.promptVariant)
    )
      return classifiedOutcome(null);
    return classifiedOutcome(summary.outcome);
  } catch {
    return classifiedOutcome(null);
  }
}
