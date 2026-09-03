import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { evaluationFingerprint, repositoryRoot } from '../records/eval-fingerprint.js';
import { checked } from './eval-codex-canary-common.js';
import { validateCanaryOptions } from './eval-codex-canary-contract.js';
import { writeCanaryEvidence } from './eval-codex-canary-evidence.js';
import { prepareMachineErrorCanary } from './eval-codex-canary-fixture.js';
import { executePreparedMachineErrorCanary } from './eval-codex-canary-run.js';

export {
  evaluateMachineErrorEvidence,
  validateCanaryOptions,
} from './eval-codex-canary-contract.js';
export { writeCanaryEvidence } from './eval-codex-canary-evidence.js';
export { prepareMachineErrorCanary } from './eval-codex-canary-fixture.js';
export { executePreparedMachineErrorCanary } from './eval-codex-canary-run.js';

function requireCandidateDigest(packageArtifact: string, expected: string) {
  if (!/^[a-f0-9]{64}$/u.test(expected)) {
    throw new Error('Expected package artifact SHA-256 must contain 64 lowercase hex characters');
  }
  const fingerprint = evaluationFingerprint(packageArtifact);
  if (fingerprint.packageArtifactSha256 !== expected) {
    throw new Error(
      `Candidate artifact SHA-256 mismatch: expected ${expected}, received ${fingerprint.packageArtifactSha256}`,
    );
  }
  return fingerprint;
}

async function runCanaryCli(raw: Record<string, string>): Promise<void> {
  const options = validateCanaryOptions(raw);
  const fingerprint = requireCandidateDigest(options.packageArtifact, raw.expectedPackageSha256);
  const sessionRoot = mkdtempSync(join(tmpdir(), 'harnessmith-codex-canary-'));
  try {
    const configuredCodexHome = process.env.CODEX_HOME ?? join(homedir(), '.codex');
    const fixture = prepareMachineErrorCanary({
      packageArtifact: options.packageArtifact,
      rootDirectory: join(sessionRoot, 'fixture'),
      authPath: join(configuredCodexHome, 'auth.json'),
    });
    const hostVersion = checked('codex', ['--version'], {
      cwd: repositoryRoot,
      env: process.env,
    }).trim();
    const startedAt = new Date().toISOString();
    const result = await executePreparedMachineErrorCanary(fixture, options);
    const finishedAt = new Date().toISOString();
    const recordPath = writeCanaryEvidence({
      outputDirectory: raw.outputDir,
      model: options.model,
      hostVersion,
      packageArtifactSha256: fingerprint.packageArtifactSha256,
      behaviorSha256: fingerprint.behaviorSha256,
      rulesSha256: fingerprint.rulesSha256,
      scenarioSha256: fingerprint.scenarios[options.scenario],
      dependencySha256: fingerprint.scenarioDependencies[options.scenario],
      startedAt,
      finishedAt,
      scenarioBudgetMs: options.scenarioBudgetMs,
      maxOutputBytes: options.maxOutputBytes,
      result,
    });
    const evidence = JSON.parse(readFileSync(recordPath, 'utf8')) as {
      verdict: { outcome: string };
    };
    process.stdout.write(
      `${JSON.stringify({ recordPath, outcome: evidence.verdict.outcome, termination: result.termination, elapsedMs: result.elapsedMs, attempts: 1 })}\n`,
    );
    if (evidence.verdict.outcome !== 'passed') process.exitCode = 1;
  } finally {
    rmSync(sessionRoot, { force: true, recursive: true });
  }
}

function canaryProgram(): Command {
  return new Command()
    .name('eval-codex-canary')
    .description('Run one bounded Codex Host Eval RC canary')
    .requiredOption('--package-artifact <path>', 'exact candidate npm tarball')
    .requiredOption('--expected-package-sha256 <sha256>', 'authorized candidate digest')
    .requiredOption('--model <model>', 'exact Codex model')
    .requiredOption('--scenario <id>', 'single scenario id')
    .requiredOption('--scenario-budget-ms <milliseconds>', 'hard scenario deadline')
    .requiredOption('--max-output-bytes <bytes>', 'independent stdout/stderr cap')
    .requiredOption('--output-dir <path>', 'new canary evidence directory')
    .action(runCanaryCli);
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  canaryProgram()
    .parseAsync()
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
