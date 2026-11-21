import { execa } from 'execa';
import type { HostEvalAttempt } from '../planning/eval-runner.js';
import { repositoryRoot } from '../records/eval-fingerprint.js';

interface EvaluatorProcessOptions {
  entry: string;
  args: string[];
  outputDir: string;
  attempt: HostEvalAttempt;
  packageArtifact: string;
  model: string;
  hostVersion: string;
  scenarioBudgetMs: number;
  matrixBudgetMs: number;
  maxOutputBytes: number;
  expectedPackageSha256?: string;
  deadlineMs?: number;
}

export function executeEvaluatorProcess(options: EvaluatorProcessOptions) {
  return execa(process.execPath, ['--import', 'tsx', options.entry, ...options.args], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      HARNESS_RELEASE_ARTIFACT: options.packageArtifact,
      HARNESS_EVAL_MODEL: options.model,
      HARNESS_EVAL_HOST_VERSION: options.hostVersion,
      HARNESS_EVAL_OUTPUT_DIR: options.outputDir,
      HARNESS_EVAL_ATTEMPT: String(options.attempt.attempt),
      HARNESS_EVAL_MAX_ATTEMPTS: String(options.attempt.maxAttempts),
      HARNESS_EVAL_SCENARIO_BUDGET_MS: String(options.scenarioBudgetMs),
      HARNESS_EVAL_MATRIX_BUDGET_MS: String(options.matrixBudgetMs),
      HARNESS_EVAL_MAX_OUTPUT_BYTES: String(options.maxOutputBytes),
      ...(options.expectedPackageSha256 === undefined
        ? {}
        : { HARNESS_EXPECTED_PACKAGE_SHA256: options.expectedPackageSha256 }),
      ...(options.deadlineMs === undefined
        ? {}
        : { HARNESS_EVAL_DEADLINE_MS: String(options.deadlineMs) }),
    },
    cancelSignal: options.attempt.signal,
    forceKillAfterDelay: 1000,
    killDescendants: true,
    maxBuffer: options.maxOutputBytes,
    reject: false,
  });
}
