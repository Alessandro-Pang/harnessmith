import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { delimiter, join } from 'node:path';
import { test } from 'vitest';

import { repositoryRoot } from '../../scripts/eval-fingerprint.js';
import { worktreeScenarioCatalog } from '../../scripts/eval-scenarios.js';
import { temporaryDirectory } from './run-fixture.js';
import { writeCandidateTarball } from './tarball-fixture.js';

const entry = join(repositoryRoot, 'scripts', 'eval-codex-matrix.ts');
const scenarioEntry = join(repositoryRoot, 'scripts', 'eval-codex-scenario.mjs');
const coverageInstrumentation =
  process.argv.includes('--coverage') ||
  process.env.NODE_V8_COVERAGE !== undefined ||
  process.env.npm_lifecycle_event?.includes('coverage') === true;

function runMatrix(overrides: Partial<Record<string, string>> = {}) {
  const options = {
    packageArtifact: '/tmp/candidate.tgz',
    expectedPackageSha256: 'a'.repeat(64),
    model: 'gpt-5.6-sol',
    concurrency: '2',
    scenarioBudgetMs: '900000',
    matrixBudgetMs: '3600000',
    maxOutputBytes: '1048576',
    outputDir: '/tmp/new-evidence',
    ...overrides,
  };
  return spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      entry,
      '--package-artifact',
      options.packageArtifact,
      '--expected-package-sha256',
      options.expectedPackageSha256,
      '--model',
      options.model,
      '--concurrency',
      options.concurrency,
      '--scenario-budget-ms',
      options.scenarioBudgetMs,
      '--matrix-budget-ms',
      options.matrixBudgetMs,
      '--max-output-bytes',
      options.maxOutputBytes,
      '--output-dir',
      options.outputDir,
    ],
    { cwd: repositoryRoot, encoding: 'utf8' },
  );
}

test('matrix CLI exposes exact candidate and bounded execution inputs without launching Codex', () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', entry, '--help'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--package-artifact/);
  assert.match(result.stdout, /--expected-package-sha256/);
  assert.match(result.stdout, /--model/);
  assert.match(result.stdout, /--concurrency/);
  assert.match(result.stdout, /--scenario-budget-ms/);
  assert.match(result.stdout, /--matrix-budget-ms/);
  assert.match(result.stdout, /--max-output-bytes/);
  assert.match(result.stdout, /--output-dir/);
});

test('matrix CLI rejects execution bounds outside the release contract', () => {
  for (const [field, value, expected] of [
    ['concurrency', '4', /concurrency.*1.*3/i],
    ['scenarioBudgetMs', '900001', /scenario budget.*900000/i],
    ['matrixBudgetMs', '3600001', /matrix budget.*3600000/i],
    ['maxOutputBytes', '1048577', /output limit.*1048576/i],
  ] as const) {
    const result = runMatrix({ [field]: value });
    assert.equal(result.status, 1, `${field}: ${result.stderr}`);
    assert.match(result.stderr, expected);
  }
});

test('matrix CLI rejects a candidate whose exact digest was not authorized', () => {
  const directory = temporaryDirectory();
  const artifact = join(directory, 'candidate.tgz');
  writeCandidateTarball(artifact, repositoryRoot);

  const result = runMatrix({
    packageArtifact: artifact,
    expectedPackageSha256: '0'.repeat(64),
    outputDir: join(directory, 'evidence'),
  });

  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /candidate artifact SHA-256 mismatch/i);
});

test('matrix run schedules the complete catalog through the bounded runner', async () => {
  const matrix = await import('../../scripts/eval-codex-matrix.js');
  assert.equal(typeof matrix.runCodexMatrix, 'function');
  const scenarioIds = worktreeScenarioCatalog(repositoryRoot).scenarios.map(({ id }) => id);
  const attempts: Array<{ scenarioId: string; attempt: number; maxAttempts: number }> = [];

  const result = await matrix.runCodexMatrix({
    scenarioIds,
    concurrency: 2,
    scenarioBudgetMs: 900_000,
    matrixBudgetMs: 3_600_000,
    execute: async (attempt: { scenarioId: string; attempt: number; maxAttempts: number }) => {
      attempts.push(attempt);
      return { outcome: 'passed', termination: 'completed' } as const;
    },
  });

  assert.equal(scenarioIds.length, 15);
  assert.deepEqual(attempts.map(({ scenarioId }) => scenarioId).sort(), [...scenarioIds].sort());
  assert.ok(attempts.every(({ attempt, maxAttempts }) => attempt === 1 && maxAttempts === 2));
  assert.equal(result.circuitOpen, false);
  assert.ok(result.results.every(({ outcome }) => outcome === 'passed'));
});

test('scenario fixture binds the supplied candidate and prepares without launching Codex', () => {
  const directory = temporaryDirectory();
  const artifact = join(directory, 'candidate.tgz');
  const outputDirectory = join(directory, 'runs');
  const codexHome = join(directory, 'codex-home');
  mkdirSync(codexHome);
  writeFileSync(join(codexHome, 'auth.json'), '{}\n');
  writeCandidateTarball(artifact, repositoryRoot);

  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', scenarioEntry, 'machine-error-contract'],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
      timeout: 30_000,
      maxBuffer: 2 * 1024 * 1024,
      env: {
        ...process.env,
        CODEX_HOME: codexHome,
        HARNESS_RELEASE_ARTIFACT: artifact,
        HARNESS_EVAL_OUTPUT_DIR: outputDirectory,
        HARNESS_EVAL_MODEL: 'gpt-5.6-sol',
        HARNESS_EVAL_ATTEMPT: '1',
        HARNESS_EVAL_MAX_ATTEMPTS: '2',
        HARNESS_EVAL_SCENARIO_BUDGET_MS: '900000',
        HARNESS_EVAL_MATRIX_BUDGET_MS: '3600000',
        HARNESS_EVAL_FIXTURE_ONLY: '1',
      },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const fixture = JSON.parse(result.stdout);
  assert.equal(fixture.candidate, artifact);
  assert.equal(fixture.scenarioId, 'machine-error-contract');
  assert.match(fixture.context, /unmanaged/i);
});

test.skipIf(coverageInstrumentation)(
  'all 15 catalog scenarios prepare disposable fixtures without launching Codex',
  () => {
    const directory = temporaryDirectory();
    const artifact = join(directory, 'candidate.tgz');
    const codexHome = join(directory, 'codex-home');
    mkdirSync(codexHome);
    writeFileSync(join(codexHome, 'auth.json'), '{}\n');
    writeCandidateTarball(artifact, repositoryRoot);
    const scenarioIds = worktreeScenarioCatalog(repositoryRoot).scenarios.map(({ id }) => id);
    for (const scenarioId of scenarioIds) {
      const result = spawnSync(process.execPath, ['--import', 'tsx', scenarioEntry, scenarioId], {
        cwd: repositoryRoot,
        encoding: 'utf8',
        timeout: 30_000,
        maxBuffer: 2 * 1024 * 1024,
        env: {
          ...process.env,
          CODEX_HOME: codexHome,
          HARNESS_RELEASE_ARTIFACT: artifact,
          HARNESS_EVAL_OUTPUT_DIR: join(directory, 'runs'),
          HARNESS_EVAL_MODEL: 'gpt-5.6-sol',
          HARNESS_EVAL_ATTEMPT: '1',
          HARNESS_EVAL_MAX_ATTEMPTS: '2',
          HARNESS_EVAL_SCENARIO_BUDGET_MS: '900000',
          HARNESS_EVAL_MATRIX_BUDGET_MS: '3600000',
          HARNESS_EVAL_FIXTURE_ONLY: '1',
        },
      });
      assert.equal(result.status, 0, `${scenarioId}: ${result.stderr}`);
      assert.equal(JSON.parse(result.stdout).scenarioId, scenarioId);
    }
    assert.equal(scenarioIds.length, 15);
  },
  120_000,
);

test('scenario Host invocation keeps the prompt on stdin through the bounded transport', () => {
  const directory = temporaryDirectory();
  const artifact = join(directory, 'candidate.tgz');
  const outputDirectory = join(directory, 'runs');
  const codexHome = join(directory, 'codex-home');
  const capturePath = join(directory, 'invocation.json');
  const fakeCodexImplementation = join(directory, 'fake-codex.mjs');
  const fakeCodex = join(directory, process.platform === 'win32' ? 'codex.cmd' : 'codex');
  mkdirSync(codexHome);
  writeFileSync(join(codexHome, 'auth.json'), '{}\n');
  writeCandidateTarball(artifact, repositoryRoot);
  const fakeCodexSource = `import { writeFileSync } from 'node:fs';
let input = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) input += chunk;
writeFileSync(process.env.HARNESS_TEST_CODEX_CAPTURE, JSON.stringify({ argv: process.argv.slice(2), stdin: input }));
process.stdout.write('{"type":"thread.started","thread_id":"01a11111-2222-7333-8444-555555555555"}\\n');
process.stdout.write('{"type":"item.completed","item":{"type":"agent_message","text":"fixture completion"}}\\n');
process.stdout.write('{"type":"turn.completed","usage":{"input_tokens":12}}\\n');
`;
  writeFileSync(fakeCodexImplementation, fakeCodexSource);
  writeFileSync(
    fakeCodex,
    process.platform === 'win32'
      ? `@echo off\r\n"${process.execPath}" "${fakeCodexImplementation}" %*\r\n`
      : `#!${process.execPath}\n${fakeCodexSource}`,
  );
  chmodSync(fakeCodex, 0o755);

  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', scenarioEntry, 'progressive-disclosure'],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
      timeout: 30_000,
      maxBuffer: 2 * 1024 * 1024,
      env: {
        ...process.env,
        PATH: `${directory}${delimiter}${process.env.PATH ?? ''}`,
        CODEX_HOME: codexHome,
        HARNESS_TEST_CODEX_CAPTURE: capturePath,
        HARNESS_RELEASE_ARTIFACT: artifact,
        HARNESS_EVAL_OUTPUT_DIR: outputDirectory,
        HARNESS_EVAL_MODEL: 'gpt-5.6-sol',
        HARNESS_EVAL_ATTEMPT: '1',
        HARNESS_EVAL_MAX_ATTEMPTS: '2',
        HARNESS_EVAL_SCENARIO_BUDGET_MS: '900000',
        HARNESS_EVAL_MATRIX_BUDGET_MS: '3600000',
        HARNESS_HOST_TURN_TIMEOUT_MS: '900000',
      },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(capturePath), true);
  const capture = JSON.parse(readFileSync(capturePath, 'utf8'));
  assert.equal(capture.argv.at(-1), '-');
  assert.deepEqual(
    capture.argv.slice(capture.argv.indexOf('--model'), capture.argv.indexOf('--model') + 2),
    ['--model', 'gpt-5.6-sol'],
  );
  assert.ok(
    !capture.argv.some((argument: string) => /Diagnose a failing focused test/.test(argument)),
  );
  assert.match(capture.stdin, /Diagnose a failing focused test/);
  const runDirectory = readdirSync(outputDirectory, { withFileTypes: true }).find((entry) =>
    entry.isDirectory(),
  );
  assert.ok(runDirectory);
  const record = JSON.parse(
    readFileSync(join(outputDirectory, runDirectory.name, 'run.json'), 'utf8'),
  );
  assert.equal(record.schemaVersion, 6);
  assert.equal(record.execution.tier, 'L3');
  assert.equal(record.verdict.outcome, 'behavior-failed');
});

test('scenario executor passes the exact matrix contract to one isolated scenario process', async () => {
  const matrix = await import('../../scripts/eval-codex-matrix.js');
  assert.equal(typeof matrix.createScenarioExecutor, 'function');
  const directory = temporaryDirectory();
  const scenarioProcess = join(directory, 'scenario.mjs');
  writeFileSync(
    scenarioProcess,
    `const required = ['HARNESS_RELEASE_ARTIFACT','HARNESS_EVAL_OUTPUT_DIR','HARNESS_EVAL_MODEL','HARNESS_EVAL_ATTEMPT','HARNESS_EVAL_MAX_ATTEMPTS','HARNESS_EVAL_SCENARIO_BUDGET_MS','HARNESS_EVAL_MATRIX_BUDGET_MS','HARNESS_EVAL_MAX_OUTPUT_BYTES','HARNESS_EVAL_HOST_VERSION'];
const complete = required.every((key) => process.env[key]);
process.stdout.write(JSON.stringify({ scenarioId: process.argv[2], outcome: complete ? 'passed' : 'evaluator-failed', termination: complete ? 'completed' : 'evaluator-failure' }) + '\\n');
`,
  );
  const execute = matrix.createScenarioExecutor({
    packageArtifact: join(directory, 'candidate.tgz'),
    outputDir: join(directory, 'runs'),
    model: 'gpt-5.6-sol',
    scenarioBudgetMs: 900_000,
    matrixBudgetMs: 3_600_000,
    maxOutputBytes: 1_048_576,
    hostVersion: 'codex-cli 1.2.3',
    scenarioEntry: scenarioProcess,
  });
  const result = await execute({
    scenarioId: 'machine-error-contract',
    attempt: 1,
    maxAttempts: 2,
    deadlineMs: Date.now() + 900_000,
    signal: new AbortController().signal,
  });
  assert.deepEqual(result, { outcome: 'passed', termination: 'completed' });
});

test('profile-control skill routing remains bounded for deeply segmented commands', async () => {
  const { isExplicitProfileControlRoutingViolation } = await import(
    // @ts-expect-error The tracked evaluator support module is intentionally plain ESM.
    '../../scripts/eval-codex-matrix-support.mjs'
  );
  const item = {
    type: 'command_execution',
    command: `skills/${'!/'.repeat(24)}not-a-skill`,
  };
  const startedAt = performance.now();

  assert.equal(
    isExplicitProfileControlRoutingViolation({ turnLabel: 'pause-profile', item }),
    false,
  );
  assert.ok(performance.now() - startedAt < 100, 'routing check exceeded its bounded runtime');
  assert.equal(
    isExplicitProfileControlRoutingViolation({
      turnLabel: 'pause-profile',
      item: { type: 'command_execution', command: 'cat /tmp/skills/memory/SKILL.md' },
    }),
    true,
  );
});
