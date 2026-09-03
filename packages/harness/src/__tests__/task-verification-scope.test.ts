import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { closeTask, initTask } from '../commands/task/task.js';
import { verifyAcceptance } from '../commands/task/task-verification.js';
import {
  captureScopeDigests,
  fileDigest,
  fileDigestIsFresh,
  scopeDigestsAreFresh,
} from '../lib/task/task-verification-scope.js';
import { capturedIo, harnessRuntime } from './helpers/harness.js';

function git(project: string, args: string[]): void {
  execFileSync('git', ['-C', project, ...args], { stdio: 'ignore' });
}

function commit(project: string, message: string): void {
  git(project, ['add', '-A']);
  execFileSync(
    'git',
    [
      '-C',
      project,
      '-c',
      'user.name=Harness Test',
      '-c',
      'user.email=harness@example.test',
      'commit',
      '-qm',
      message,
    ],
    { stdio: 'ignore' },
  );
}

test('explicit scopes include ignored files and nested repository content', () => {
  const project = mkdtempSync(join(tmpdir(), 'harness-task-verify-scope-'));
  onTestFinished(() => rmSync(project, { recursive: true, force: true }));
  git(project, ['init', '-q']);
  const runtime = harnessRuntime(project);
  const initialize = (id: string) =>
    initTask(
      runtime,
      { project, id, objective: `Verify ${id}`, acceptance: ['Scoped content stays fresh'] },
      capturedIo(),
    );

  writeFileSync(join(project, '.gitignore'), 'ignored.txt\n');
  writeFileSync(join(project, 'ignored.txt'), 'ignored-before\n');
  commit(project, 'ignore policy');
  initialize('ignored-proof');
  verifyAcceptance(
    {
      project,
      id: 'ignored-proof',
      criterion: 'criterion-1',
      type: 'test',
      command: process.execPath,
      args: ['-e', 'process.exit(0)'],
      scope: ['ignored.txt'],
    },
    capturedIo(),
  );
  writeFileSync(join(project, 'ignored.txt'), 'ignored-after\n');
  assert.throws(
    () => closeTask({ project, id: 'ignored-proof', summary: 'stale ignored scope' }),
    /stale or non-passing evidence/,
  );

  const nested = join(project, 'nested-repository');
  mkdirSync(nested);
  git(nested, ['init', '-q']);
  writeFileSync(join(nested, 'tracked.txt'), 'nested-before\n');
  commit(nested, 'nested baseline');
  initialize('nested-proof');
  verifyAcceptance(
    {
      project,
      id: 'nested-proof',
      criterion: 'criterion-1',
      type: 'test',
      command: process.execPath,
      args: ['-e', 'process.exit(0)'],
      scope: ['nested-repository'],
    },
    capturedIo(),
  );
  writeFileSync(join(nested, 'tracked.txt'), 'nested-after\n');
  assert.throws(
    () => closeTask({ project, id: 'nested-proof', summary: 'stale nested scope' }),
    /stale or non-passing evidence/,
  );
});

test('diff verification binds the Git workspace and explicit scope', () => {
  const project = mkdtempSync(join(tmpdir(), 'harness-task-diff-'));
  onTestFinished(() => rmSync(project, { recursive: true, force: true }));
  git(project, ['init', '-q']);
  const runtime = harnessRuntime(project);
  writeFileSync(join(project, 'scope.txt'), 'stable\n');
  commit(project, 'diff baseline');
  initTask(
    runtime,
    { project, id: 'diff-proof', objective: 'Verify diff', acceptance: ['Diff is current'] },
    capturedIo(),
  );

  const verified = verifyAcceptance(
    {
      project,
      id: 'diff-proof',
      criterion: 'criterion-1',
      type: 'diff',
      scope: ['scope.txt'],
    },
    capturedIo(),
  );
  const evidence = verified.acceptance[0].evidence[0];
  if (evidence.type !== 'diff') throw new Error('Expected diff evidence');
  assert.equal(evidence.reference, 'git-workspace');
  assert.equal(evidence.artifactDigest, evidence.workspaceDigest);
  assert.equal(
    closeTask({ project, id: 'diff-proof', summary: 'Current diff proof' }).status,
    'complete',
  );
});

test('diff verification fails closed outside Git', () => {
  const project = mkdtempSync(join(tmpdir(), 'harness-task-diff-nongit-'));
  onTestFinished(() => rmSync(project, { recursive: true, force: true }));
  const runtime = harnessRuntime(project);
  writeFileSync(join(project, 'scope.txt'), 'stable\n');
  initTask(
    runtime,
    { project, id: 'diff-nongit', objective: 'Reject diff', acceptance: ['Diff is current'] },
    capturedIo(),
  );

  assert.throws(
    () =>
      verifyAcceptance({
        project,
        id: 'diff-nongit',
        criterion: 'criterion-1',
        type: 'diff',
        scope: ['scope.txt'],
      }),
    /requires a readable Git workspace/,
  );
});

test('scope digest helpers fail closed for missing, linked, stale, and non-file inputs', () => {
  const project = mkdtempSync(join(tmpdir(), 'harness-task-scope-invalid-'));
  onTestFinished(() => rmSync(project, { recursive: true, force: true }));
  mkdirSync(join(project, 'directory'));
  writeFileSync(join(project, 'target.txt'), 'target\n');
  symlinkSync('target.txt', join(project, 'linked.txt'));

  assert.throws(() => captureScopeDigests(project, ['missing.txt']), /does not exist/);
  assert.throws(() => captureScopeDigests(project, ['linked.txt']), /symbolic link/);
  assert.throws(() => fileDigest(project, 'directory'), /regular file/);
  assert.equal(fileDigestIsFresh(project, 'missing.txt', `sha256:${'0'.repeat(64)}`), false);
  assert.equal(
    scopeDigestsAreFresh(project, [{ path: 'missing.txt', digest: `sha256:${'0'.repeat(64)}` }]),
    false,
  );
});

test('scope validation and hashing share one entry budget without an unbounded prewalk', () => {
  const project = mkdtempSync(join(tmpdir(), 'harness-task-scope-budget-'));
  onTestFinished(() => rmSync(project, { recursive: true, force: true }));
  const first = join(project, 'first');
  const second = join(project, 'second');
  mkdirSync(first);
  mkdirSync(second);
  writeFileSync(join(first, 'a.txt'), 'a');
  writeFileSync(join(second, 'b.txt'), 'b');

  assert.throws(
    () => captureScopeDigests(project, ['first', 'second'], { maxEntries: 3 }),
    /entry budget exceeded/i,
  );

  symlinkSync('a.txt', join(first, 'z-link'));
  assert.throws(
    () => captureScopeDigests(project, ['first'], { maxEntries: 2 }),
    /entry budget exceeded/i,
  );
});

test('scope sets reject excessive and overlapping paths before hashing', () => {
  const project = mkdtempSync(join(tmpdir(), 'harness-task-scope-count-'));
  onTestFinished(() => rmSync(project, { recursive: true, force: true }));
  mkdirSync(join(project, 'parent'));
  writeFileSync(join(project, 'parent', 'child.txt'), 'child');
  const files = Array.from({ length: 17 }, (_, index) => `scope-${index}.txt`);
  for (const file of files) writeFileSync(join(project, file), file);

  assert.throws(() => captureScopeDigests(project, files), /at most 16 verification scopes/i);
  assert.throws(
    () => captureScopeDigests(project, ['parent', 'parent/child.txt']),
    /overlapping verification scopes/i,
  );
});

test('scope hashing shares byte, depth, and duration budgets', () => {
  const project = mkdtempSync(join(tmpdir(), 'harness-task-scope-hard-budgets-'));
  onTestFinished(() => rmSync(project, { recursive: true, force: true }));
  mkdirSync(join(project, 'deep', 'child'), { recursive: true });
  writeFileSync(join(project, 'first.txt'), '123');
  writeFileSync(join(project, 'second.txt'), '456');
  writeFileSync(join(project, 'deep', 'child', 'leaf.txt'), 'leaf');

  assert.throws(
    () => captureScopeDigests(project, ['first.txt', 'second.txt'], { maxBytes: 5 }),
    /total byte budget exceeded/i,
  );
  assert.throws(
    () => captureScopeDigests(project, ['deep'], { maxDepth: 2 }),
    /depth budget exceeded/i,
  );

  const broad = join(project, 'broad');
  mkdirSync(broad);
  for (let index = 0; index < 500; index += 1) {
    writeFileSync(join(broad, `${index}.txt`), 'x');
  }
  assert.throws(
    () => captureScopeDigests(project, ['broad'], { maxDurationMs: 1 }),
    /time budget exceeded/i,
  );
});
