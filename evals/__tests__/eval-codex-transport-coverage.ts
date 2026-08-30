import assert from 'node:assert/strict';
import {
  buildCodexInvocation,
  createCodexHostEvalExecutor,
  runBoundedHostProcess,
} from '../../scripts/eval-codex-transport.js';

const cwd = process.cwd();
const signal = new AbortController().signal;
const fixture = (source: string) => ({ executable: process.execPath, args: ['-e', source], cwd });
const runFixture = (source: string, maxOutputBytes = 1024) =>
  runBoundedHostProcess({
    invocation: fixture(source),
    prompt: 'fixture prompt',
    signal,
    maxOutputBytes,
  });

assert.deepEqual(buildCodexInvocation({ executable: '/bin/codex', workspace: '/tmp/eval' }), {
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
assert.throws(() => buildCodexInvocation({ workspace: 'relative' }), /absolute workspace/);

assert.equal(
  (
    await runFixture(
      "process.stdin.setEncoding('utf8');let data='';process.stdin.on('data',chunk=>data+=chunk);process.stdin.on('end',()=>process.stdout.write(data))",
    )
  ).kind,
  'completed',
);
await assert.rejects(
  runBoundedHostProcess({
    invocation: fixture(''),
    prompt: 'fixture prompt',
    signal,
    maxOutputBytes: 0,
  }),
  /output limit/,
);
await assert.rejects(
  runBoundedHostProcess({
    invocation: fixture(''),
    prompt: 'fixture prompt',
    signal,
    maxOutputBytes: 1024 * 1024 + 1,
  }),
  /output limit/,
);

const canceled = new AbortController();
setTimeout(() => canceled.abort(), 20);
assert.deepEqual(
  await runBoundedHostProcess({
    invocation: fixture('setInterval(() => undefined, 1000)'),
    prompt: 'fixture prompt',
    signal: canceled.signal,
    maxOutputBytes: 1024,
  }),
  { kind: 'transport-failure', reason: 'canceled' },
);
assert.equal(
  (await runFixture("process.stdout.write('x'.repeat(128))", 32)).kind,
  'evaluator-failure',
);
assert.equal(
  (await runFixture("process.stderr.write('x'.repeat(128))", 32)).kind,
  'evaluator-failure',
);
assert.deepEqual(
  await runBoundedHostProcess({
    invocation: { executable: 'harnessmith-missing-host-fixture', args: [], cwd },
    prompt: 'fixture prompt',
    signal,
    maxOutputBytes: 1024,
  }),
  { kind: 'transport-failure', reason: 'process-unavailable' },
);

for (const message of ['ECONNRESET', 'WebSocket connection failed', 'TLS handshake error']) {
  assert.deepEqual(
    await runFixture(`process.stderr.write(${JSON.stringify(message)});process.exit(1)`),
    { kind: 'transport-failure', reason: 'connection' },
  );
}
assert.deepEqual(await runFixture('process.exit(2)'), {
  kind: 'evaluator-failure',
  reason: 'host-exit',
});

const attempt = {
  scenarioId: 'fixture',
  attempt: 1,
  maxAttempts: 2,
  deadlineMs: Date.now() + 1000,
  signal,
} as const;
const completed = {
  kind: 'completed',
  exitCode: 0,
  stdout: '{"type":"turn.completed"}',
  stderr: '',
} as const;
assert.equal(
  (
    await createCodexHostEvalExecutor({
      workspace: '/tmp/eval',
      promptForScenario: (scenarioId) => scenarioId,
      runProcess: async () => completed,
      evaluate: async () => ({ outcome: 'passed', termination: 'completed' }),
    })(attempt)
  ).outcome,
  'passed',
);
assert.equal(
  (
    await createCodexHostEvalExecutor({
      workspace: '/tmp/eval',
      promptForScenario: () => 'fixture prompt',
      runProcess: async () => ({ kind: 'transport-failure', reason: 'connection' }),
      evaluate: async () => ({ outcome: 'passed', termination: 'completed' }),
    })(attempt)
  ).outcome,
  'infra-inconclusive',
);
assert.equal(
  (
    await createCodexHostEvalExecutor({
      workspace: '/tmp/eval',
      promptForScenario: () => 'fixture prompt',
      runProcess: async () => ({ kind: 'evaluator-failure', reason: 'output-limit' }),
      evaluate: async () => ({ outcome: 'passed', termination: 'completed' }),
    })(attempt)
  ).outcome,
  'evaluator-failed',
);
assert.equal(
  (
    await createCodexHostEvalExecutor({
      workspace: '/tmp/eval',
      maxOutputBytes: 1024,
      promptForScenario: () => 'fixture prompt',
      runProcess: async () => completed,
      evaluate: async () => {
        throw new Error('fixture evaluator crash');
      },
    })(attempt)
  ).outcome,
  'evaluator-failed',
);

assert.equal(
  typeof createCodexHostEvalExecutor({
    workspace: '/tmp/eval',
    promptForScenario: () => 'not executed',
    evaluate: async () => ({ outcome: 'passed', termination: 'completed' }),
  }),
  'function',
);
