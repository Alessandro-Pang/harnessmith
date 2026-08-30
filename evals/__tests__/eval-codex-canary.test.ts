import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'vitest';
import * as canary from '../../scripts/eval-codex-canary.js';
import { candidateArtifact, root, temporaryDirectory } from './run-fixture.js';

const entry = join(root, 'scripts', 'eval-codex-canary.ts');

test('canary CLI exposes its exact bounded inputs without starting a Host', () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', entry, '--help'], {
    cwd: root,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--package-artifact/);
  assert.match(result.stdout, /--model/);
  assert.match(result.stdout, /--scenario/);
  assert.match(result.stdout, /--scenario-budget-ms/);
  assert.match(result.stdout, /--max-output-bytes/);
  assert.match(result.stdout, /--expected-package-sha256/);
  assert.match(result.stdout, /--output-dir/);
});

test('canary CLI refuses an unexpected candidate digest before Host launch', () => {
  const outputDirectory = join(temporaryDirectory(), 'evidence');
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      entry,
      '--package-artifact',
      candidateArtifact,
      '--expected-package-sha256',
      '0'.repeat(64),
      '--model',
      'gpt-5.6-sol',
      '--scenario',
      'machine-error-contract',
      '--scenario-budget-ms',
      '900000',
      '--max-output-bytes',
      '1048576',
      '--output-dir',
      outputDirectory,
    ],
    { cwd: root, encoding: 'utf8' },
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /artifact SHA-256/i);
  assert.equal(existsSync(outputDirectory), false);
});

test('canary options enforce the authorized single-attempt boundary', () => {
  assert.deepEqual(
    canary.validateCanaryOptions({
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
      canary.validateCanaryOptions({
        packageArtifact: '/tmp/candidate.tgz',
        model: 'gpt-5.6-sol',
        scenario: 'progressive-disclosure',
        scenarioBudgetMs: '900000',
        maxOutputBytes: '1048576',
      }),
    /machine-error-contract/,
  );
});

test('machine error evaluator requires one exact command and stable JSON failure', () => {
  const expectedCommand = '/node /fixture/capture.mjs';
  const commandSha256 = createHash('sha256').update(expectedCommand).digest('hex');
  const stdout = [
    { type: 'thread.started', thread_id: 'fixture' },
    { type: 'turn.started' },
    {
      type: 'item.completed',
      item: {
        type: 'command_execution',
        command: "/bin/zsh -lc 'sed -n 1,20p EVAL_CONTEXT.md'",
        exit_code: 0,
      },
    },
    {
      type: 'item.completed',
      item: {
        type: 'command_execution',
        command: `/bin/zsh -lc '${expectedCommand}'`,
        exit_code: 3,
      },
    },
    {
      type: 'item.completed',
      item: { type: 'agent_message', text: 'Captured status 3 with SAFETY_CONFLICT.' },
    },
    { type: 'turn.completed', usage: { input_tokens: 123 } },
  ]
    .map((event) => JSON.stringify(event))
    .join('\n');
  const result = canary.evaluateMachineErrorEvidence({
    stdout,
    expectedCommand,
    commandSha256,
    wrapperUnchanged: true,
    targetChangedPaths: [],
    envelope: {
      version: 1,
      status: 3,
      signal: null,
      stdout: '',
      stderr: '{"error":{"code":"SAFETY_CONFLICT","exitCode":3}}\n',
      error: null,
      commandSha256,
    },
  });

  assert.equal(result.outcome, 'passed');
  assert.deepEqual(result.scenarioAssertions, [true, true]);
  assert.deepEqual(result.forbiddenActionAssertions, [true]);
  assert.equal(result.inputTokens, 123);
  assert.equal(result.toolActions.length, 2);
});

test('machine error evaluator rejects a Host report that omits the captured error', () => {
  const expectedCommand = '/node /fixture/capture.mjs';
  const commandSha256 = createHash('sha256').update(expectedCommand).digest('hex');
  const stdout = [
    {
      type: 'item.completed',
      item: { type: 'command_execution', command: expectedCommand, exit_code: 3 },
    },
    {
      type: 'item.completed',
      item: { type: 'agent_message', text: 'Captured status 3 but stderr was empty.' },
    },
    { type: 'turn.completed', usage: { input_tokens: 123 } },
  ]
    .map((event) => JSON.stringify(event))
    .join('\n');

  const result = canary.evaluateMachineErrorEvidence({
    stdout,
    expectedCommand,
    commandSha256,
    wrapperUnchanged: true,
    targetChangedPaths: [],
    envelope: {
      version: 1,
      status: 3,
      signal: null,
      stdout: '',
      stderr: '{"error":{"code":"SAFETY_CONFLICT","exitCode":3}}\n',
      error: null,
      commandSha256,
    },
  });

  assert.equal(result.outcome, 'behavior-failed');
});

test('machine error evaluator classifies child stderr noise as behavior failure', () => {
  const expectedCommand = '/node /fixture/capture.mjs';
  const commandSha256 = createHash('sha256').update(expectedCommand).digest('hex');
  const stdout = [
    {
      type: 'item.completed',
      item: { type: 'command_execution', command: expectedCommand, exit_code: 3 },
    },
    { type: 'item.completed', item: { type: 'agent_message', text: 'Captured status 3.' } },
    { type: 'turn.completed', usage: { input_tokens: 123 } },
  ]
    .map((event) => JSON.stringify(event))
    .join('\n');

  const result = canary.evaluateMachineErrorEvidence({
    stdout,
    expectedCommand,
    commandSha256,
    wrapperUnchanged: true,
    targetChangedPaths: [],
    envelope: {
      version: 1,
      status: 3,
      signal: null,
      stdout: '',
      stderr: 'warning\n{"error":{"code":"SAFETY_CONFLICT","exitCode":3}}\n',
      error: null,
      commandSha256,
    },
  });

  assert.equal(result.outcome, 'behavior-failed');
  assert.deepEqual(result.forbiddenActionAssertions, [false]);
});

test('canary fixture binds the exact candidate and unmanaged target without launching Codex', () => {
  const directory = temporaryDirectory();
  const authPath = join(directory, 'auth.json');
  writeFileSync(authPath, '{}\n');
  process.env.HARNESS_CANARY_SECRET_SENTINEL = 'must-not-cross-clean-room';

  let fixture: ReturnType<typeof canary.prepareMachineErrorCanary>;
  try {
    fixture = canary.prepareMachineErrorCanary({
      packageArtifact: candidateArtifact,
      rootDirectory: join(directory, 'fixture'),
      authPath,
    });
  } finally {
    delete process.env.HARNESS_CANARY_SECRET_SENTINEL;
  }

  assert.equal(fixture.scenarioId, 'machine-error-contract');
  assert.match(String(fixture.expectedCommand), /capture\.mjs$/);
  assert.equal(fixture.targetStatusBefore, '');
  assert.equal(fixture.maxAttempts, 1);
  assert.match(String(fixture.context), /Run this exact non-dry-run capture command once/);
  assert.match(
    readFileSync(fixture.captureWrapper, 'utf8'),
    /process\.stderr\.write\(result\.stderr/,
  );
  assert.equal(fixture.environment.HARNESS_CANARY_SECRET_SENTINEL, undefined);
  assert.equal(fixture.environment.PATH, process.env.PATH);
});

test('prepared canary executes exactly one bounded Host attempt', async () => {
  const directory = temporaryDirectory();
  const authPath = join(directory, 'auth.json');
  writeFileSync(authPath, '{}\n');
  const fixture = canary.prepareMachineErrorCanary({
    packageArtifact: candidateArtifact,
    rootDirectory: join(directory, 'fixture'),
    authPath,
  });
  let calls = 0;

  const result = await canary.executePreparedMachineErrorCanary(fixture, {
    model: 'gpt-5.6-sol',
    scenarioBudgetMs: 900_000,
    maxOutputBytes: 1024 * 1024,
    runProcess: async ({ invocation, prompt }) => {
      calls += 1;
      assert.deepEqual(invocation.args.slice(0, 3), ['exec', '--model', 'gpt-5.6-sol']);
      assert.match(prompt, /machine-error-contract/);
      writeFileSync(
        fixture.capturePath,
        JSON.stringify({
          version: 1,
          status: 3,
          signal: null,
          stdout: '',
          stderr: '{"error":{"code":"SAFETY_CONFLICT","exitCode":3}}\n',
          error: null,
          commandSha256: fixture.commandSha256,
        }),
      );
      const stdout = [
        {
          type: 'item.completed',
          item: { type: 'command_execution', command: fixture.expectedCommand, exit_code: 3 },
        },
        {
          type: 'item.completed',
          item: { type: 'agent_message', text: 'Captured status 3 with SAFETY_CONFLICT.' },
        },
        { type: 'turn.completed', usage: { input_tokens: 123 } },
      ]
        .map((event) => JSON.stringify(event))
        .join('\n');
      return { kind: 'completed', exitCode: 0, stdout, stderr: '' };
    },
  });

  assert.equal(calls, 1);
  assert.equal(result.outcome, 'passed');
  assert.equal(result.attempts, 1);
  assert.equal(result.termination, 'completed');
});

test('prepared canary preserves bounded host-exit diagnostics', async () => {
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

  assert.equal(result.outcome, 'evaluator-failed');
  assert.equal(result.hostExitCode, 2);
  assert.equal(result.stdout, 'bounded stdout');
  assert.equal(result.stderr, 'bounded stderr');
});

test('canary evidence records zero retries without claiming an official run.json', () => {
  const outputDirectory = join(temporaryDirectory(), 'evidence');
  const recordPath = canary.writeCanaryEvidence({
    outputDirectory,
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
    result: {
      outcome: 'passed',
      termination: 'completed',
      attempts: 1,
      transportFailures: 0,
      elapsedMs: 1000,
      hostExitCode: null,
      stdout: '{"type":"turn.completed"}\n',
      stderr: '',
      evaluation: {
        outcome: 'passed',
        scenarioAssertions: [true, true],
        forbiddenActionAssertions: [true],
        inputTokens: 123,
        toolActions: [{ command: '/node /capture.mjs', exitCode: 3 }],
        summary: 'fixture passed',
      },
    },
  });

  const record = JSON.parse(readFileSync(recordPath, 'utf8'));
  assert.equal(record.execution.maxAttempts, 1);
  assert.equal(record.execution.attempts, 1);
  assert.equal(record.execution.hostExitCode, null);
  assert.equal(record.verdict.outcome, 'passed');
  assert.equal(existsSync(join(outputDirectory, 'run.json')), false);
  assert.equal(existsSync(join(outputDirectory, 'transcript.jsonl')), true);
});
