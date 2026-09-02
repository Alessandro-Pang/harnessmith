import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { execa } from 'execa';
import { whichCommand } from 'which-command';
import { createScenarioExecutor } from './eval-codex-scenario-process.js';
import { gateEvaluationRecords, validateEvaluationRecords } from '../contracts/eval-contract.js';
import { evaluationFingerprint, repositoryRoot } from '../records/eval-fingerprint.js';
import { type HostEvalRunnerOptions, runHostEvalScenarios } from '../planning/eval-runner.js';
import { worktreeScenarioCatalog } from '../planning/eval-scenarios.js';

export { createScenarioExecutor } from './eval-codex-scenario-process.js';

export type CodexMatrixOptions = {
  packageArtifact: string;
  expectedPackageSha256: string;
  model: string;
  concurrency: number;
  scenarioBudgetMs: number;
  matrixBudgetMs: number;
  maxOutputBytes: number;
  outputDir: string;
};

function boundedInteger(label: string, value: string, minimum: number, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}`);
  }
  return parsed;
}

export function validateMatrixOptions(raw: Record<string, string>): CodexMatrixOptions {
  const concurrency = boundedInteger('Host Eval concurrency', raw.concurrency, 1, 3);
  const scenarioBudgetMs = boundedInteger(
    'Host Eval scenario budget',
    raw.scenarioBudgetMs,
    1,
    900_000,
  );
  const matrixBudgetMs = boundedInteger(
    'Host Eval matrix budget',
    raw.matrixBudgetMs,
    scenarioBudgetMs,
    3_600_000,
  );
  const maxOutputBytes = boundedInteger(
    'Host process output limit',
    raw.maxOutputBytes,
    1,
    1_048_576,
  );
  if (!/^[a-f0-9]{64}$/u.test(raw.expectedPackageSha256)) {
    throw new Error('Expected package artifact SHA-256 must contain 64 lowercase hex characters');
  }
  if (!raw.model.trim()) throw new Error('Codex model must be non-empty');
  if (!isAbsolute(raw.packageArtifact)) {
    throw new Error('Candidate package artifact path must be absolute');
  }
  if (!isAbsolute(raw.outputDir)) throw new Error('Matrix output directory must be absolute');
  return {
    packageArtifact: raw.packageArtifact,
    expectedPackageSha256: raw.expectedPackageSha256,
    model: raw.model,
    concurrency,
    scenarioBudgetMs,
    matrixBudgetMs,
    maxOutputBytes,
    outputDir: raw.outputDir,
  };
}

export function requireMatrixCandidate(options: CodexMatrixOptions) {
  if (existsSync(options.outputDir)) {
    throw new Error('Matrix output directory must not already exist');
  }
  const fingerprint = evaluationFingerprint(options.packageArtifact);
  if (fingerprint.packageArtifactSha256 !== options.expectedPackageSha256) {
    throw new Error(
      `Candidate artifact SHA-256 mismatch: expected ${options.expectedPackageSha256}, received ${fingerprint.packageArtifactSha256}`,
    );
  }
  return fingerprint;
}

export async function runCodexMatrix(
  options: Pick<
    HostEvalRunnerOptions,
    'scenarioIds' | 'execute' | 'concurrency' | 'scenarioBudgetMs' | 'matrixBudgetMs' | 'clock'
  >,
) {
  const expected = worktreeScenarioCatalog(repositoryRoot).scenarios.map(({ id }) => id);
  if (
    options.scenarioIds.length !== expected.length ||
    options.scenarioIds.some((scenarioId, index) => scenarioId !== expected[index])
  ) {
    throw new Error('Codex L3 matrix must contain the complete ordered scenario catalog');
  }
  return runHostEvalScenarios(options);
}

async function codexHostVersion(): Promise<string> {
  const executable = await whichCommand('codex', { cwd: repositoryRoot });
  if (!executable) throw new Error('Codex CLI is unavailable');
  const result = await execa(executable, ['--version'], {
    cwd: repositoryRoot,
    maxBuffer: 64 * 1024,
    reject: false,
  });
  const version = result.stdout.trim();
  if (result.exitCode !== 0 || !version) throw new Error('Codex CLI version probe failed');
  return version;
}

export async function executeCodexMatrix(options: CodexMatrixOptions) {
  requireMatrixCandidate(options);
  const hostVersion = await codexHostVersion();
  mkdirSync(options.outputDir, { recursive: false });
  const scenarioIds = worktreeScenarioCatalog(repositoryRoot).scenarios.map(({ id }) => id);
  const matrix = await runCodexMatrix({
    scenarioIds,
    concurrency: options.concurrency,
    scenarioBudgetMs: options.scenarioBudgetMs,
    matrixBudgetMs: options.matrixBudgetMs,
    execute: createScenarioExecutor({ ...options, hostVersion }),
  });
  const summary = {
    schemaVersion: 1,
    candidateSha256: options.expectedPackageSha256,
    model: options.model,
    hostVersion,
    ...matrix,
  };
  writeFileSync(
    `${options.outputDir}/matrix-summary.json`,
    `${JSON.stringify(summary, null, 2)}\n`,
    { encoding: 'utf8', flag: 'wx' },
  );
  validateEvaluationRecords({ runsDirectory: options.outputDir });
  if (matrix.results.every(({ outcome }) => outcome === 'passed')) {
    gateEvaluationRecords({
      runsDirectory: options.outputDir,
      packageArtifact: options.packageArtifact,
    });
  }
  return summary;
}

function matrixProgram(): Command {
  return new Command()
    .name('eval-codex-matrix')
    .description('Run the complete bounded Codex Host Eval matrix')
    .requiredOption('--package-artifact <path>', 'exact candidate npm tarball')
    .requiredOption('--expected-package-sha256 <sha256>', 'authorized candidate digest')
    .requiredOption('--model <model>', 'exact Codex model')
    .requiredOption('--concurrency <count>', 'bounded scenario concurrency')
    .requiredOption('--scenario-budget-ms <milliseconds>', 'hard per-scenario deadline')
    .requiredOption('--matrix-budget-ms <milliseconds>', 'hard matrix deadline')
    .requiredOption('--max-output-bytes <bytes>', 'independent stdout/stderr cap')
    .requiredOption('--output-dir <path>', 'new formal evidence directory')
    .action(async (raw: Record<string, string>) => {
      const summary = await executeCodexMatrix(validateMatrixOptions(raw));
      process.stdout.write(`${JSON.stringify(summary)}\n`);
      if (summary.results.some(({ outcome }) => outcome !== 'passed')) process.exitCode = 1;
    });
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  matrixProgram()
    .parseAsync()
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
