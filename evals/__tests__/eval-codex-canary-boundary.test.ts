import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'vitest';
import * as canary from '../../scripts/evaluation/codex/eval-codex-canary.js';
import { shellArgument } from '../../scripts/evaluation/codex/eval-codex-canary-common.js';
import type { MachineErrorCanaryResult } from '../../scripts/evaluation/codex/eval-codex-canary-run.js';
import { candidateArtifact, temporaryDirectory } from './run-fixture.js';

test('shell arguments stay unquoted only for safe characters and escape single quotes', () => {
  assert.equal(shellArgument('/tmp/plain-path'), '/tmp/plain-path');
  assert.equal(shellArgument("path with 'quote"), "'path with '\\''quote'");
});

test('canary options reject empty identities and a zero scenario budget', () => {
  assert.throws(
    () =>
      canary.validateCanaryOptions({
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
      canary.validateCanaryOptions({
        packageArtifact: '/tmp/candidate.tgz',
        model: 'gpt-5.6-sol',
        scenario: 'machine-error-contract',
        scenarioBudgetMs: '0',
        maxOutputBytes: '1',
      }),
    /scenario budget/,
  );
});

test('machine error evaluator fails closed on malformed or incomplete Host output', () => {
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
  const base = {
    expectedCommand,
    commandSha256,
    wrapperUnchanged: true,
    targetChangedPaths: [],
    envelope,
  };

  assert.throws(
    () => canary.evaluateMachineErrorEvidence({ ...base, stdout: `${JSON.stringify([])}\n` }),
    /must be an object/,
  );
  assert.throws(
    () =>
      canary.evaluateMachineErrorEvidence({
        ...base,
        stdout: JSON.stringify({ type: 'turn.started' }),
      }),
    /missing completed turn evidence/,
  );

  const violatedStdout = [
    {
      type: 'item.completed',
      item: { type: 'command_execution', command: '/node /different.mjs', exit_code: 3 },
    },
    {
      type: 'item.completed',
      item: { type: 'agent_message', text: 'Captured status 3 with SAFETY_CONFLICT.' },
    },
    { type: 'turn.completed', usage: { input_tokens: 123 } },
  ]
    .map((event) => JSON.stringify(event))
    .join('\n');
  const violated = canary.evaluateMachineErrorEvidence({
    ...base,
    stdout: violatedStdout,
    wrapperUnchanged: false,
    targetChangedPaths: ['owned.txt'],
    envelope: { ...envelope, stderr: 'not-json' },
  });
  assert.equal(violated.outcome, 'behavior-failed');
});

test('canary fixture requires a new absolute root and available Host authentication', () => {
  const directory = temporaryDirectory();
  const authPath = join(directory, 'auth.json');
  writeFileSync(authPath, '{}\n');
  assert.throws(
    () =>
      canary.prepareMachineErrorCanary({
        packageArtifact: candidateArtifact,
        rootDirectory: 'relative',
        authPath,
      }),
    /new absolute path/,
  );
  assert.throws(
    () =>
      canary.prepareMachineErrorCanary({
        packageArtifact: candidateArtifact,
        rootDirectory: join(directory, 'missing-auth-fixture'),
        authPath: join(directory, 'missing-auth.json'),
      }),
    /authentication is unavailable/,
  );
});

test('prepared canary terminates at the scenario budget without retrying', async () => {
  const directory = temporaryDirectory();
  const authPath = join(directory, 'auth.json');
  writeFileSync(authPath, '{}\n');
  const fixture = canary.prepareMachineErrorCanary({
    packageArtifact: candidateArtifact,
    rootDirectory: join(directory, 'fixture'),
    authPath,
  });

  const result = await canary.executePreparedMachineErrorCanary(fixture, {
    model: 'gpt-5.6-sol',
    scenarioBudgetMs: 1,
    maxOutputBytes: 1024 * 1024,
    runProcess: async ({ signal }) => {
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve()));
      return { kind: 'transport-failure', reason: 'canceled' };
    },
  });

  assert.equal(result.termination, 'scenario-budget-exhausted');
});

test('canary evidence requires a new absolute directory and redacts secret patterns', () => {
  const directory = temporaryDirectory();
  const result: MachineErrorCanaryResult = {
    outcome: 'passed',
    termination: 'completed',
    attempts: 1,
    transportFailures: 0,
    elapsedMs: 1000,
    hostExitCode: null,
    stdout: 'Authorization: Bearer secret-value-that-was-not-redacted\n',
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
  const options = {
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
    result,
  };

  assert.throws(
    () => canary.writeCanaryEvidence({ ...options, outputDirectory: 'relative-evidence' }),
    /new absolute path/,
  );
  const recordPath = canary.writeCanaryEvidence({
    ...options,
    outputDirectory: join(directory, 'redacted-evidence'),
  });
  const record = JSON.parse(readFileSync(recordPath, 'utf8'));
  assert.equal(record.redactionApplied, true);
  assert.equal(record.verdict.outcome, 'evaluator-failed');
});
