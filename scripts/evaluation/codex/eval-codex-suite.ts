import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { execa } from 'execa';
import { whichCommand } from 'which-command';
import { runPromptRouteBenchmark } from '../../benchmarks/prompt-route/prompt-route-benchmark-lib.js';
import { evaluateCoverage } from '../contracts/eval-coverage.js';
import { repositoryRoot } from '../records/eval-fingerprint.js';
import {
  type CodexMatrixOptions,
  requireMatrixCandidate,
  validateMatrixOptions,
} from './eval-codex-options.js';
import {
  bindCaseEvidence,
  collectSuiteArtifacts,
  type SuiteCaseResult,
} from './eval-suite-evidence.js';
import { executeSuiteCase } from './eval-suite-process.js';
import { evaluationContractDigest, evaluationRegistry } from './eval-suite-registry.js';
import { runEvaluationSuite, summarizeSuiteResults } from './eval-suite-scheduler.js';

export type CodexSuiteSummary = {
  schemaVersion: 2;
  recordType: 'codex-evaluation-suite';
  candidateSha256: string;
  contractSha256: string;
  host: { adapter: 'codex'; version: string; model: string; reasoningEffort: 'medium' };
  startedAt: string;
  finishedAt: string;
  promptRoute: ReturnType<typeof runPromptRouteBenchmark>;
  coverage: ReturnType<typeof evaluateCoverage>;
  circuitOpen: boolean;
  results: SuiteCaseResult[];
  artifacts: ReturnType<typeof collectSuiteArtifacts>;
  result: 'passed' | 'failed' | 'inconclusive';
};

async function codexHostVersion(): Promise<string> {
  const executable = await whichCommand('codex', { cwd: repositoryRoot });
  if (!executable) throw new Error('Codex CLI is unavailable');
  const result = await execa(executable, ['--version'], {
    cwd: repositoryRoot,
    timeout: 10_000,
    maxBuffer: 64 * 1024,
    reject: false,
  });
  if (result.exitCode !== 0 || !result.stdout.trim())
    throw new Error('Codex CLI version probe failed');
  return result.stdout.trim();
}

export async function executeCodexSuite(options: CodexMatrixOptions): Promise<CodexSuiteSummary> {
  requireMatrixCandidate(options);
  const hostVersion = await codexHostVersion();
  const entries = evaluationRegistry();
  const contractSha256 = evaluationContractDigest();
  const startedAt = new Date().toISOString();
  mkdirSync(options.outputDir, { recursive: false });
  const promptRoute = runPromptRouteBenchmark();
  writeFileSync(
    join(options.outputDir, 'prompt-route.json'),
    JSON.stringify(promptRoute, null, 2),
    { flag: 'wx' },
  );
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const requiredIds = entries.map((entry) => entry.id);
  const matrix = await runEvaluationSuite({
    ...options,
    requiredIds,
    scenarioIds: requiredIds,
    execute: (attempt) => {
      const entry = byId.get(attempt.scenarioId);
      if (!entry) throw new Error(`Unknown evaluation case ${attempt.scenarioId}`);
      return executeSuiteCase({ ...options, hostVersion }, entry, attempt);
    },
  });
  const results = matrix.results.map((result) => {
    const entry = byId.get(result.scenarioId);
    if (!entry) throw new Error('Scheduler returned an unknown case');
    return bindCaseEvidence(
      options.outputDir,
      entry,
      result,
      options.expectedPackageSha256,
      options.model,
    );
  });
  const coverage = evaluateCoverage(results, entries);
  writeFileSync(
    join(options.outputDir, 'coverage-report.json'),
    JSON.stringify(coverage, null, 2),
    { flag: 'wx' },
  );
  const outcome = summarizeSuiteResults(requiredIds, results);
  const unchanged = evaluationContractDigest() === contractSha256;
  const result =
    !unchanged || promptRoute.result !== 'passed' || outcome === 'failed'
      ? 'failed'
      : coverage.result !== 'passed' || outcome !== 'passed'
        ? 'inconclusive'
        : 'passed';
  const summary: CodexSuiteSummary = {
    schemaVersion: 2,
    recordType: 'codex-evaluation-suite',
    candidateSha256: options.expectedPackageSha256,
    contractSha256,
    host: {
      adapter: 'codex',
      version: hostVersion,
      model: options.model,
      reasoningEffort: 'medium',
    },
    startedAt,
    finishedAt: new Date().toISOString(),
    promptRoute,
    coverage,
    circuitOpen: matrix.circuitOpen,
    results,
    artifacts: collectSuiteArtifacts(options.outputDir),
    result,
  };
  writeFileSync(
    join(options.outputDir, 'suite-summary.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
    { encoding: 'utf8', flag: 'wx' },
  );
  return summary;
}

function program(): Command {
  return new Command()
    .name('eval-codex')
    .description('Run the complete deterministic and real Host Codex evaluation suite')
    .requiredOption('--package-artifact <path>', 'exact candidate npm tarball')
    .requiredOption('--expected-package-sha256 <sha256>', 'authorized candidate digest')
    .requiredOption('--model <model>', 'exact Codex model')
    .option('--concurrency <count>', 'bounded scenario concurrency', '2')
    .option('--scenario-budget-ms <milliseconds>', 'hard per-scenario deadline', '900000')
    .option('--matrix-budget-ms <milliseconds>', 'hard matrix deadline', '3600000')
    .option('--max-output-bytes <bytes>', 'independent stdout/stderr cap', '1048576')
    .requiredOption('--output-dir <path>', 'new formal suite evidence directory')
    .action(async (raw: Record<string, string>) => {
      const summary = await executeCodexSuite(
        validateMatrixOptions({
          ...raw,
          concurrency: raw.concurrency ?? '2',
          scenarioBudgetMs: raw.scenarioBudgetMs ?? '900000',
          matrixBudgetMs: raw.matrixBudgetMs ?? '3600000',
          maxOutputBytes: raw.maxOutputBytes ?? '1048576',
        }),
      );
      process.stdout.write(`${JSON.stringify(summary)}\n`);
      if (summary.result !== 'passed') process.exitCode = 1;
    });
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  program()
    .parseAsync()
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
