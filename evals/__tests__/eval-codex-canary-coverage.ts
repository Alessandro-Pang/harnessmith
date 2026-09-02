import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shellArgument } from '../../scripts/evaluation/codex/eval-codex-canary-common.js';
import {
  evaluateMachineErrorEvidence,
  validateCanaryOptions,
} from '../../scripts/evaluation/codex/eval-codex-canary-contract.js';
import { writeCanaryEvidence } from '../../scripts/evaluation/codex/eval-codex-canary-evidence.js';
import { prepareMachineErrorCanary } from '../../scripts/evaluation/codex/eval-codex-canary-fixture.js';
import {
  executePreparedMachineErrorCanary,
  type MachineErrorCanaryResult,
} from '../../scripts/evaluation/codex/eval-codex-canary-run.js';
import { writeCandidateTarball } from './tarball-fixture.js';

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const temporaryRoot = mkdtempSync(join(tmpdir(), 'harnessmith-canary-coverage-'));

function completedStdout(expectedCommand: string): string {
  return [
    {
      type: 'item.completed',
      item: { type: 'command_execution', command: expectedCommand, exit_code: 3 },
    },
    {
      type: 'item.completed',
      item: { type: 'agent_message', text: 'Captured status 3 with SAFETY_CONFLICT.' },
    },
    { type: 'turn.completed', usage: { input_tokens: 123 } },
  ]
    .map((event) => JSON.stringify(event))
    .join('\n');
}

function passingResult(stdout = 'transcript\n'): MachineErrorCanaryResult {
  return {
    outcome: 'passed',
    termination: 'completed',
    attempts: 1,
    transportFailures: 0,
    elapsedMs: 10,
    hostExitCode: null,
    stdout,
    stderr: '',
    evaluation: {
      outcome: 'passed',
      scenarioAssertions: [true, true],
      forbiddenActionAssertions: [true],
      inputTokens: 123,
      toolActions: [{ command: '/node /capture.mjs', exitCode: 3 }],
      summary: 'fixture passed',
    },
  };
}

try {
  assert.equal(shellArgument('/tmp/plain-path'), '/tmp/plain-path');
  assert.equal(shellArgument("path with 'quote"), "'path with '\\''quote'");

  assert.deepEqual(
    validateCanaryOptions({
      packageArtifact: '/tmp/candidate.tgz',
      model: 'gpt-5.6-sol',
      scenario: 'machine-error-contract',
      scenarioBudgetMs: '900000',
      maxOutputBytes: '1048576',
    }),
    {
      packageArtifact: '/tmp/candidate.tgz',
      model: 'gpt-5.6-sol',
      scenario: 'machine-error-contract',
      scenarioBudgetMs: 900_000,
      maxOutputBytes: 1024 * 1024,
      maxAttempts: 1,
    },
  );
  assert.throws(
    () =>
      validateCanaryOptions({
        packageArtifact: '',
        model: '',
        scenario: 'machine-error-contract',
        scenarioBudgetMs: '1',
        maxOutputBytes: '1',
      }),
    /non-empty/,
  );
  assert.throws(
    () =>
      validateCanaryOptions({
        packageArtifact: '/tmp/candidate.tgz',
        model: 'gpt-5.6-sol',
        scenario: 'different',
        scenarioBudgetMs: '1',
        maxOutputBytes: '1',
      }),
    /machine-error-contract/,
  );
  assert.throws(
    () =>
      validateCanaryOptions({
        packageArtifact: '/tmp/candidate.tgz',
        model: 'gpt-5.6-sol',
        scenario: 'machine-error-contract',
        scenarioBudgetMs: '0',
        maxOutputBytes: '1',
      }),
    /scenario budget/,
  );

  const expectedCommand = '/node /fixture/capture.mjs';
  const commandSha256 = createHash('sha256').update(expectedCommand).digest('hex');
  const envelope = {
    version: 1 as const,
    status: 3,
    signal: null,
    stdout: '',
    stderr: '{"error":{"code":"SAFETY_CONFLICT","exitCode":3}}\n',
    error: null,
    commandSha256,
  };
  assert.equal(
    evaluateMachineErrorEvidence({
      stdout: completedStdout(expectedCommand),
      expectedCommand,
      commandSha256,
      wrapperUnchanged: true,
      targetChangedPaths: [],
      envelope,
    }).outcome,
    'passed',
  );
  assert.equal(
    evaluateMachineErrorEvidence({
      stdout: completedStdout('/node /different.mjs'),
      expectedCommand,
      commandSha256,
      wrapperUnchanged: false,
      targetChangedPaths: ['owned.txt'],
      envelope: { ...envelope, stderr: 'not-json' },
    }).outcome,
    'behavior-failed',
  );
  assert.throws(
    () =>
      evaluateMachineErrorEvidence({
        stdout: `${JSON.stringify([])}\n`,
        expectedCommand,
        commandSha256,
        wrapperUnchanged: true,
        targetChangedPaths: [],
        envelope,
      }),
    /must be an object/,
  );
  assert.throws(
    () =>
      evaluateMachineErrorEvidence({
        stdout: JSON.stringify({ type: 'turn.started' }),
        expectedCommand,
        commandSha256,
        wrapperUnchanged: true,
        targetChangedPaths: [],
        envelope,
      }),
    /missing completed turn evidence/,
  );

  const candidateArtifact = join(temporaryRoot, 'candidate.tgz');
  writeCandidateTarball(candidateArtifact, root);
  const authPath = join(temporaryRoot, 'auth.json');
  writeFileSync(authPath, '{}\n');
  assert.throws(
    () =>
      prepareMachineErrorCanary({
        packageArtifact: candidateArtifact,
        rootDirectory: 'relative',
        authPath,
      }),
    /new absolute path/,
  );
  assert.throws(
    () =>
      prepareMachineErrorCanary({
        packageArtifact: candidateArtifact,
        rootDirectory: join(temporaryRoot, 'missing-auth-fixture'),
        authPath: join(temporaryRoot, 'missing-auth.json'),
      }),
    /authentication is unavailable/,
  );

  const fixture = prepareMachineErrorCanary({
    packageArtifact: candidateArtifact,
    rootDirectory: join(temporaryRoot, 'fixture'),
    authPath,
  });
  const passed = await executePreparedMachineErrorCanary(fixture, {
    model: 'gpt-5.6-sol',
    scenarioBudgetMs: 900_000,
    maxOutputBytes: 1024 * 1024,
    runProcess: async () => {
      writeFileSync(
        fixture.capturePath,
        JSON.stringify({ ...envelope, commandSha256: fixture.commandSha256 }),
      );
      return {
        kind: 'completed',
        exitCode: 0,
        stdout: completedStdout(fixture.expectedCommand),
        stderr: '',
      };
    },
  });
  assert.equal(passed.outcome, 'passed');

  const hostExitFixture = prepareMachineErrorCanary({
    packageArtifact: candidateArtifact,
    rootDirectory: join(temporaryRoot, 'host-exit-fixture'),
    authPath,
  });
  const hostExit = await executePreparedMachineErrorCanary(hostExitFixture, {
    model: 'gpt-5.6-sol',
    scenarioBudgetMs: 900_000,
    maxOutputBytes: 1024 * 1024,
    runProcess: async () => ({
      kind: 'evaluator-failure',
      reason: 'host-exit',
      exitCode: 2,
      stdout: 'bounded stdout',
      stderr: 'bounded stderr',
    }),
  });
  assert.equal(hostExit.hostExitCode, 2);

  const timeoutFixture = prepareMachineErrorCanary({
    packageArtifact: candidateArtifact,
    rootDirectory: join(temporaryRoot, 'timeout-fixture'),
    authPath,
  });
  const timeout = await executePreparedMachineErrorCanary(timeoutFixture, {
    model: 'gpt-5.6-sol',
    scenarioBudgetMs: 1,
    maxOutputBytes: 1024 * 1024,
    runProcess: async ({ signal }) => {
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve()));
      return { kind: 'transport-failure', reason: 'canceled' };
    },
  });
  assert.equal(timeout.termination, 'scenario-budget-exhausted');

  const evidenceDirectory = join(temporaryRoot, 'evidence');
  const recordPath = writeCanaryEvidence({
    outputDirectory: evidenceDirectory,
    model: 'gpt-5.6-sol',
    hostVersion: '0.150.1',
    packageArtifactSha256: 'a'.repeat(64),
    behaviorSha256: 'b'.repeat(64),
    rulesSha256: 'c'.repeat(64),
    scenarioSha256: 'd'.repeat(64),
    dependencySha256: 'e'.repeat(64),
    startedAt: '2026-08-30T00:00:00.000Z',
    finishedAt: '2026-08-30T00:00:01.000Z',
    scenarioBudgetMs: 900_000,
    maxOutputBytes: 1024 * 1024,
    result: passingResult(),
  });
  assert.equal(JSON.parse(readFileSync(recordPath, 'utf8')).verdict.outcome, 'passed');
  assert.equal(existsSync(join(evidenceDirectory, 'run.json')), false);
  assert.throws(
    () =>
      writeCanaryEvidence({
        outputDirectory: evidenceDirectory,
        model: 'gpt-5.6-sol',
        hostVersion: '0.150.1',
        packageArtifactSha256: 'a'.repeat(64),
        behaviorSha256: 'b'.repeat(64),
        rulesSha256: 'c'.repeat(64),
        scenarioSha256: 'd'.repeat(64),
        dependencySha256: 'e'.repeat(64),
        startedAt: '2026-08-30T00:00:00.000Z',
        finishedAt: '2026-08-30T00:00:01.000Z',
        scenarioBudgetMs: 900_000,
        maxOutputBytes: 1024 * 1024,
        result: passingResult(),
      }),
    /new absolute path/,
  );
  const redactedPath = writeCanaryEvidence({
    outputDirectory: join(temporaryRoot, 'redacted-evidence'),
    model: 'gpt-5.6-sol',
    hostVersion: '0.150.1',
    packageArtifactSha256: 'a'.repeat(64),
    behaviorSha256: 'b'.repeat(64),
    rulesSha256: 'c'.repeat(64),
    scenarioSha256: 'd'.repeat(64),
    dependencySha256: 'e'.repeat(64),
    startedAt: '2026-08-30T00:00:00.000Z',
    finishedAt: '2026-08-30T00:00:01.000Z',
    scenarioBudgetMs: 900_000,
    maxOutputBytes: 1024 * 1024,
    result: passingResult('Authorization: Bearer secret-value-that-was-not-redacted\n'),
  });
  assert.equal(JSON.parse(readFileSync(redactedPath, 'utf8')).redactionApplied, true);
} finally {
  rmSync(temporaryRoot, { force: true, recursive: true });
}
