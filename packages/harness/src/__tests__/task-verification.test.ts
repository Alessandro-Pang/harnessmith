import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { runCli } from '../cli.js';
import { closeTask, initTask, taskStatus } from '../commands/task/task.js';
import { updateAcceptance } from '../commands/task/task-acceptance.js';
import { verifyAcceptance } from '../commands/task/task-verification.js';
import { projectSnapshot } from '../lib/project/project.js';
import { capturedIo, harnessRuntime } from './helpers/harness.js';

function git(project: string, args: string[]): string {
  return execFileSync('git', ['-C', project, ...args], { encoding: 'utf8' }).trim();
}

function commit(project: string, message: string): string {
  git(project, ['add', '.']);
  git(project, [
    '-c',
    'user.name=Harness Test',
    '-c',
    'user.email=harness@example.test',
    'commit',
    '-q',
    '-m',
    message,
  ]);
  return git(project, ['rev-parse', '--short=12', 'HEAD']);
}

function projectFixture(prefix = 'harness-task-verify-') {
  const project = mkdtempSync(join(tmpdir(), prefix));
  onTestFinished(() => rmSync(project, { recursive: true, force: true }));
  git(project, ['init', '-q']);
  return { project, runtime: harnessRuntime(project) };
}

function initVerificationTask(
  project: string,
  runtime: ReturnType<typeof harnessRuntime>,
  id: string,
) {
  return initTask(
    runtime,
    { project, id, objective: 'Mechanically verify evidence', acceptance: ['Verified'] },
    capturedIo(),
  );
}

test('passed rejects caller-reported command, digest, and observation evidence', () => {
  const { project, runtime } = projectFixture();
  initVerificationTask(project, runtime, 'reject-reported');
  const accept = (evidence: Record<string, unknown>) =>
    updateAcceptance({
      project,
      id: 'reject-reported',
      criterion: 'criterion-1',
      status: 'passed',
      evidence: [JSON.stringify(evidence)],
    });

  assert.throws(
    () => accept({ type: 'test', command: 'true', exitCode: 0 }),
    /task verify|does not support passed/,
  );
  assert.throws(
    () =>
      accept({
        type: 'file',
        reference: 'missing.txt',
        artifactDigest: `sha256:${'0'.repeat(64)}`,
      }),
    /task verify|does not support passed/,
  );
  assert.throws(
    () => accept({ type: 'observation', tool: 'human', result: 'looks good' }),
    /task verify|does not support passed/,
  );
});

test('task verify executes commands and records harness-produced proof', () => {
  const { project, runtime } = projectFixture();
  writeFileSync(join(project, 'scope.txt'), 'stable\n');
  initVerificationTask(project, runtime, 'command-proof');
  const verified = verifyAcceptance(
    {
      project,
      id: 'command-proof',
      criterion: 'criterion-1',
      type: 'test',
      command: process.execPath,
      args: ['-e', 'process.stdout.write("verified")'],
      scope: ['scope.txt'],
    },
    capturedIo(),
  );

  assert.equal(verified.acceptance[0].status, 'passed');
  const evidence = verified.acceptance[0].evidence[0];
  assert.equal(evidence.type, 'test');
  assert.equal(evidence.producer, 'harness');
  assert.equal(evidence.taskId, 'command-proof');
  assert.equal(evidence.criterionId, 'criterion-1');
  if (evidence.type !== 'test') throw new Error('Expected test evidence');
  assert.equal(evidence.exitCode, 0);
  assert.deepEqual(evidence.args, ['-e', 'process.stdout.write("verified")']);
  assert.match(evidence.outputDigest || '', /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(
    evidence.scopeDigests.map(({ path }) => path),
    ['scope.txt'],
  );
});

test('task verify CLI accepts executable args and explicit freshness scopes', () => {
  const { project, runtime } = projectFixture();
  writeFileSync(join(project, 'scope.txt'), 'stable\n');
  assert.equal(
    runCli(
      [
        'task',
        'init',
        '--project',
        project,
        '--id',
        'cli-proof',
        '--objective',
        'Verify from CLI',
        '--accept',
        'Tests pass',
      ],
      { runtime, io: capturedIo() },
    ),
    0,
  );
  assert.equal(
    runCli(
      [
        'task',
        'verify',
        '--project',
        project,
        '--id',
        'cli-proof',
        '--criterion',
        'criterion-1',
        '--type',
        'test',
        '--command',
        process.execPath,
        '--arg',
        '-e',
        '--arg',
        'process.exit(0)',
        '--scope',
        'scope.txt',
      ],
      { runtime, io: capturedIo() },
    ),
    0,
  );
  const task = taskStatus({ project, id: 'cli-proof' }, capturedIo());
  if (Array.isArray(task)) throw new Error('Expected one task');
  assert.equal(task.acceptance[0].status, 'passed');
});

test('task verify persists a mechanically captured failing exit code without passing', () => {
  const { project, runtime } = projectFixture();
  writeFileSync(join(project, 'scope.txt'), 'stable\n');
  initVerificationTask(project, runtime, 'failed-command');

  assert.throws(
    () =>
      verifyAcceptance({
        project,
        id: 'failed-command',
        criterion: 'criterion-1',
        type: 'command',
        command: process.execPath,
        args: ['-e', 'process.exit(3)'],
        scope: ['scope.txt'],
      }),
    /exit code 3/,
  );
  const task = taskStatus({ project, id: 'failed-command' }, capturedIo());
  if (Array.isArray(task)) throw new Error('Expected one task');
  assert.equal(task.acceptance[0].status, 'failed');
  const evidence = task.acceptance[0].evidence[0];
  assert.equal(evidence.producer, 'harness');
  if (evidence.type !== 'command') throw new Error('Expected command evidence');
  assert.equal(evidence.exitCode, 3);
});

test('task verify validates scopes before executing a command with side effects', () => {
  const { project, runtime } = projectFixture();
  initVerificationTask(project, runtime, 'preflight-scope');
  const marker = join(project, 'must-not-exist');

  assert.throws(
    () =>
      verifyAcceptance({
        project,
        id: 'preflight-scope',
        criterion: 'criterion-1',
        type: 'command',
        command: process.execPath,
        args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran')`],
        scope: [],
      }),
    /requires --scope/,
  );
  assert.equal(existsSync(marker), false);
});

test('task verify rejects high-confidence secret material before execution or persistence', () => {
  const { project, runtime } = projectFixture();
  writeFileSync(join(project, 'scope.txt'), 'stable\n');
  initVerificationTask(project, runtime, 'secret-argv');
  const marker = join(project, 'must-not-run-secret');
  const fakeCredential = `Bearer ${'A'.repeat(24)}`;

  assert.throws(
    () =>
      verifyAcceptance({
        project,
        id: 'secret-argv',
        criterion: 'criterion-1',
        type: 'command',
        command: process.execPath,
        args: [
          '-e',
          `require('node:fs').writeFileSync(${JSON.stringify(marker)}, process.argv[1])`,
          fakeCredential,
        ],
        scope: ['scope.txt'],
      }),
    /secret material/i,
  );
  assert.equal(existsSync(marker), false);
  const task = taskStatus({ project, id: 'secret-argv' }, capturedIo());
  if (Array.isArray(task)) throw new Error('Expected one task');
  assert.equal(JSON.stringify(task).includes(fakeCredential), false);
});

test('caller-reported Task evidence rejects high-confidence secret material before persistence', () => {
  const { project, runtime } = projectFixture();
  initVerificationTask(project, runtime, 'secret-external');
  const fakeCredential = `Bearer ${'C'.repeat(24)}`;

  assert.throws(
    () =>
      updateAcceptance({
        project,
        id: 'secret-external',
        criterion: 'criterion-1',
        status: 'inconclusive',
        evidence: [
          JSON.stringify({ type: 'test', command: `curl -H ${fakeCredential}`, exitCode: 0 }),
        ],
      }),
    /secret material/i,
  );
  const task = taskStatus({ project, id: 'secret-external' }, capturedIo());
  if (Array.isArray(task)) throw new Error('Expected one task');
  assert.equal(JSON.stringify(task).includes(fakeCredential), false);
});

test('verification scopes reject case variants of Harness metadata directories', () => {
  const { project, runtime } = projectFixture();
  initVerificationTask(project, runtime, 'metadata-case');

  assert.throws(
    () =>
      verifyAcceptance({
        project,
        id: 'metadata-case',
        criterion: 'criterion-1',
        type: 'test',
        command: process.execPath,
        args: ['-e', 'process.exit(0)'],
        scope: ['.GIT/config'],
      }),
    /targets harness metadata/i,
  );
});

test('command output digest includes stderr even when the command succeeds', () => {
  const { project, runtime } = projectFixture();
  writeFileSync(join(project, 'scope.txt'), 'stable\n');
  initVerificationTask(project, runtime, 'stderr-one');
  initVerificationTask(project, runtime, 'stderr-two');

  const verify = (id: string, message: string) =>
    verifyAcceptance(
      {
        project,
        id,
        criterion: 'criterion-1',
        type: 'test',
        command: process.execPath,
        args: ['-e', `process.stderr.write(${JSON.stringify(message)})`],
        scope: ['scope.txt'],
      },
      capturedIo(),
    ).acceptance[0].evidence[0];
  const first = verify('stderr-one', 'one');
  const second = verify('stderr-two', 'two');
  if (first.type !== 'test' || second.type !== 'test') throw new Error('Expected test evidence');
  assert.notEqual(first.outputDigest, second.outputDigest);
});

test('task verify fails closed when a declared scope changes during command execution', () => {
  const { project, runtime } = projectFixture();
  const scope = join(project, 'scope.txt');
  writeFileSync(scope, 'before\n');
  initVerificationTask(project, runtime, 'changing-scope');

  assert.throws(
    () =>
      verifyAcceptance({
        project,
        id: 'changing-scope',
        criterion: 'criterion-1',
        type: 'test',
        command: process.execPath,
        args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(scope)}, 'after\\n')`],
        scope: ['scope.txt'],
      }),
    /scope changed while the command was running/,
  );
  const task = taskStatus({ project, id: 'changing-scope' }, capturedIo());
  if (Array.isArray(task)) throw new Error('Expected one task');
  assert.equal(task.acceptance[0].status, 'failed');
});

test('task verify fails closed when the Git workspace changes outside the declared scope', () => {
  const { project, runtime } = projectFixture();
  const changed = join(project, 'changed-outside-scope.txt');
  writeFileSync(join(project, 'scope.txt'), 'stable\n');
  commit(project, 'stable verifier input');
  initVerificationTask(project, runtime, 'changing-workspace');

  assert.throws(
    () =>
      verifyAcceptance({
        project,
        id: 'changing-workspace',
        criterion: 'criterion-1',
        type: 'test',
        command: process.execPath,
        args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(changed)}, 'changed\\n')`],
        scope: ['scope.txt'],
      }),
    /project workspace changed while the command was running/,
  );
});

test('file verification computes its own digest and close rechecks the artifact', () => {
  const { project, runtime } = projectFixture();
  const artifact = join(project, 'result.txt');
  writeFileSync(artifact, 'verified\n');
  initVerificationTask(project, runtime, 'file-proof');
  const verified = verifyAcceptance(
    {
      project,
      id: 'file-proof',
      criterion: 'criterion-1',
      type: 'file',
      file: 'result.txt',
    },
    capturedIo(),
  );
  assert.equal(verified.acceptance[0].status, 'passed');
  const evidence = verified.acceptance[0].evidence[0];
  assert.equal(evidence.producer, 'harness');
  if (evidence.type !== 'file') throw new Error('Expected file evidence');
  assert.match(evidence.artifactDigest, /^sha256:[0-9a-f]{64}$/);

  writeFileSync(artifact, 'changed\n');
  assert.throws(
    () => closeTask({ project, id: 'file-proof', summary: 'stale file proof' }),
    /stale or non-passing evidence/,
  );
});

test('non-Git verification has a non-null workspace digest and detects scoped changes', () => {
  const project = mkdtempSync(join(tmpdir(), 'harness-task-verify-nongit-'));
  onTestFinished(() => rmSync(project, { recursive: true, force: true }));
  const runtime = harnessRuntime(project);
  writeFileSync(join(project, 'scope.txt'), 'before\n');
  assert.match(projectSnapshot(project).workspaceDigest || '', /^sha256:[0-9a-f]{64}$/);
  initVerificationTask(project, runtime, 'non-git-proof');
  verifyAcceptance(
    {
      project,
      id: 'non-git-proof',
      criterion: 'criterion-1',
      type: 'test',
      command: process.execPath,
      args: ['-e', 'process.exit(0)'],
      scope: ['scope.txt'],
    },
    capturedIo(),
  );
  writeFileSync(join(project, 'scope.txt'), 'after\n');
  assert.throws(
    () => closeTask({ project, id: 'non-git-proof', summary: 'stale scope' }),
    /stale or non-passing evidence/,
  );
});
