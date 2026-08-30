import assert from 'node:assert/strict';
import { test } from 'vitest';
import * as transport from '../../scripts/eval-codex-transport.js';

const { buildCodexInvocation } = transport;

test('Codex invocation keeps the prompt on stdin and uses bounded safe flags', () => {
  const invocation = buildCodexInvocation({ executable: '/bin/codex', workspace: '/tmp/eval' });

  assert.deepEqual(invocation, {
    executable: '/bin/codex',
    args: [
      'exec',
      '--json',
      '--ephemeral',
      '--sandbox',
      'workspace-write',
      '--approve-for-me',
      '--cd',
      '/tmp/eval',
      '-',
    ],
    cwd: '/tmp/eval',
  });
  assert.equal(
    invocation.args.some((arg) => arg.includes('dangerously')),
    false,
  );
});

test('Codex invocation requires an absolute disposable workspace', () => {
  assert.throws(() => buildCodexInvocation({ workspace: 'relative/eval' }), /absolute workspace/);
});

test('bounded host process sends the scenario prompt through stdin', async () => {
  const controller = new AbortController();
  const prompt = 'fixture prompt that must not appear in argv';
  const result = await transport.runBoundedHostProcess({
    invocation: {
      executable: process.execPath,
      args: [
        '-e',
        "process.stdin.setEncoding('utf8');let data='';process.stdin.on('data',chunk=>data+=chunk);process.stdin.on('end',()=>{process.stdout.write(data);process.stderr.write('fixture stderr')})",
      ],
      cwd: process.cwd(),
    },
    prompt,
    signal: controller.signal,
    maxOutputBytes: 1024,
  });

  assert.deepEqual(result, {
    kind: 'completed',
    exitCode: 0,
    stdout: prompt,
    stderr: 'fixture stderr',
  });
});

test('bounded host process rejects output limits outside the hard cap', async () => {
  const base = {
    invocation: { executable: process.execPath, args: ['-e', ''], cwd: process.cwd() },
    prompt: 'fixture prompt',
    signal: new AbortController().signal,
  };

  await assert.rejects(
    transport.runBoundedHostProcess({ ...base, maxOutputBytes: 0 }),
    /output limit/,
  );
  await assert.rejects(
    transport.runBoundedHostProcess({ ...base, maxOutputBytes: 1024 * 1024 + 1 }),
    /output limit/,
  );
});

test('bounded host process classifies runner cancellation as transport failure', async () => {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 20);

  const result = await transport.runBoundedHostProcess({
    invocation: {
      executable: process.execPath,
      args: ['-e', 'setInterval(() => undefined, 1000)'],
      cwd: process.cwd(),
    },
    prompt: 'fixture prompt',
    signal: controller.signal,
    maxOutputBytes: 1024,
  });

  assert.deepEqual(result, { kind: 'transport-failure', reason: 'canceled' });
});

test('bounded host process classifies output overflow as evaluator failure', async () => {
  const result = await transport.runBoundedHostProcess({
    invocation: {
      executable: process.execPath,
      args: ['-e', "process.stdout.write('x'.repeat(128))"],
      cwd: process.cwd(),
    },
    prompt: 'fixture prompt',
    signal: new AbortController().signal,
    maxOutputBytes: 32,
  });

  assert.deepEqual(result, { kind: 'evaluator-failure', reason: 'output-limit' });
});

test('bounded host process applies the same hard cap to stderr', async () => {
  const result = await transport.runBoundedHostProcess({
    invocation: {
      executable: process.execPath,
      args: ['-e', "process.stderr.write('x'.repeat(128))"],
      cwd: process.cwd(),
    },
    prompt: 'fixture prompt',
    signal: new AbortController().signal,
    maxOutputBytes: 32,
  });

  assert.deepEqual(result, { kind: 'evaluator-failure', reason: 'output-limit' });
});

test('bounded host process classifies a missing executable as transport failure', async () => {
  const result = await transport.runBoundedHostProcess({
    invocation: {
      executable: 'harnessmith-missing-host-fixture',
      args: [],
      cwd: process.cwd(),
    },
    prompt: 'fixture prompt',
    signal: new AbortController().signal,
    maxOutputBytes: 1024,
  });

  assert.deepEqual(result, { kind: 'transport-failure', reason: 'process-unavailable' });
});

test('bounded host process classifies a Codex connection error as transport failure', async () => {
  const result = await transport.runBoundedHostProcess({
    invocation: {
      executable: process.execPath,
      args: [
        '-e',
        "process.stderr.write('WebSocket connection failed: TLS handshake');process.exit(1)",
      ],
      cwd: process.cwd(),
    },
    prompt: 'fixture prompt',
    signal: new AbortController().signal,
    maxOutputBytes: 1024,
  });

  assert.deepEqual(result, { kind: 'transport-failure', reason: 'connection' });
});

test('bounded host process classifies an unrecognized host exit as evaluator failure', async () => {
  const result = await transport.runBoundedHostProcess({
    invocation: {
      executable: process.execPath,
      args: ['-e', "process.stderr.write('unexpected fixture failure');process.exit(2)"],
      cwd: process.cwd(),
    },
    prompt: 'fixture prompt',
    signal: new AbortController().signal,
    maxOutputBytes: 1024,
  });

  assert.deepEqual(result, { kind: 'evaluator-failure', reason: 'host-exit' });
});

test('Codex executor delegates completed output to the behavior evaluator', async () => {
  let observedPrompt = '';
  const execute = transport.createCodexHostEvalExecutor({
    workspace: '/tmp/eval',
    promptForScenario: (scenarioId) => `prompt:${scenarioId}`,
    runProcess: async (options) => {
      observedPrompt = options.prompt;
      assert.equal(options.invocation.args.includes(options.prompt), false);
      return { kind: 'completed', exitCode: 0, stdout: '{"type":"turn.completed"}', stderr: '' };
    },
    evaluate: async (capture) => {
      assert.match(capture.stdout, /turn\.completed/);
      return { outcome: 'behavior-failed', termination: 'completed' };
    },
  });

  const result = await execute({
    scenarioId: 'safe-path',
    attempt: 1,
    maxAttempts: 2,
    deadlineMs: Date.now() + 1000,
    signal: new AbortController().signal,
  });

  assert.equal(observedPrompt, 'prompt:safe-path');
  assert.deepEqual(result, { outcome: 'behavior-failed', termination: 'completed' });
});

test('Codex executor maps process transport failures without calling the evaluator', async () => {
  const execute = transport.createCodexHostEvalExecutor({
    workspace: '/tmp/eval',
    promptForScenario: () => 'fixture prompt',
    runProcess: async () => ({ kind: 'transport-failure', reason: 'connection' }),
    evaluate: async () => {
      throw new Error('behavior evaluator must not run');
    },
  });

  const result = await execute({
    scenarioId: 'network',
    attempt: 1,
    maxAttempts: 2,
    deadlineMs: Date.now() + 1000,
    signal: new AbortController().signal,
  });

  assert.deepEqual(result, {
    outcome: 'infra-inconclusive',
    termination: 'transport-failure',
  });
});

test('Codex executor preserves process evaluator failures', async () => {
  const execute = transport.createCodexHostEvalExecutor({
    workspace: '/tmp/eval',
    promptForScenario: () => 'fixture prompt',
    runProcess: async () => ({ kind: 'evaluator-failure', reason: 'output-limit' }),
    evaluate: async () => {
      throw new Error('behavior evaluator must not run');
    },
  });

  const result = await execute({
    scenarioId: 'overflow',
    attempt: 1,
    maxAttempts: 2,
    deadlineMs: Date.now() + 1000,
    signal: new AbortController().signal,
  });

  assert.deepEqual(result, {
    outcome: 'evaluator-failed',
    termination: 'evaluator-failure',
  });
});

test('Codex executor never treats exit zero as passed when the evaluator crashes', async () => {
  const execute = transport.createCodexHostEvalExecutor({
    workspace: '/tmp/eval',
    promptForScenario: () => 'fixture prompt',
    runProcess: async () => ({
      kind: 'completed',
      exitCode: 0,
      stdout: '{"type":"turn.completed"}',
      stderr: '',
    }),
    evaluate: async () => {
      throw new Error('fixture evaluator crash');
    },
  });

  const result = await execute({
    scenarioId: 'completed-without-verdict',
    attempt: 1,
    maxAttempts: 2,
    deadlineMs: Date.now() + 1000,
    signal: new AbortController().signal,
  });

  assert.deepEqual(result, {
    outcome: 'evaluator-failed',
    termination: 'evaluator-failure',
  });
});
