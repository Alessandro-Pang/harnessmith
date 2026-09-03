import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { closeTask, initTask, taskStatus } from '../commands/task/task.js';
import { updateAcceptance } from '../commands/task/task-acceptance.js';
import { verifyAcceptance } from '../commands/task/task-verification.js';
import { capturedIo, harnessRuntime } from './helpers/harness.js';

function projectFixture(): { project: string; runtime: ReturnType<typeof harnessRuntime> } {
  const root = mkdtempSync(join(tmpdir(), 'harness-task-evidence-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['-C', root, 'init', '-q']);
  writeFileSync(join(root, 'verification.txt'), 'verification scope\n');
  return { project: root, runtime: harnessRuntime(root) };
}

function commit(project: string, message: string): string {
  execFileSync('git', ['-C', project, 'add', '.']);
  execFileSync('git', [
    '-C',
    project,
    '-c',
    'user.name=Harness Test',
    '-c',
    'user.email=harness@example.test',
    'commit',
    '-q',
    '-m',
    message,
  ]);
  return execFileSync('git', ['-C', project, 'rev-parse', '--short=12', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
}

function testEvidence(command = 'pnpm run test:harness', exitCode = 0): string {
  return JSON.stringify({ type: 'test', command, exitCode });
}

function verifyTest(project: string, id: string, scope = 'verification.txt') {
  return verifyAcceptance(
    {
      project,
      id,
      criterion: 'criterion-1',
      type: 'test',
      command: process.execPath,
      args: ['-e', 'process.exit(0)'],
      scope: [scope],
    },
    capturedIo(),
  );
}

test('acceptance rejects unstructured or non-passing evidence', () => {
  const { project, runtime } = projectFixture();
  initTask(
    runtime,
    { project, id: 'typed-evidence', objective: 'Require typed evidence', acceptance: ['Tests'] },
    capturedIo(),
  );

  assert.throws(
    () =>
      updateAcceptance({
        project,
        id: 'typed-evidence',
        criterion: 'criterion-1',
        status: 'inconclusive',
        evidence: ['test:any-string'],
      }),
    /JSON object/,
  );
  assert.throws(
    () =>
      updateAcceptance({
        project,
        id: 'typed-evidence',
        criterion: 'criterion-1',
        status: 'passed',
        evidence: [testEvidence('pnpm test', 1)],
      }),
    /cannot mark acceptance passed.*task verify/i,
  );
});

test('external typed evidence is validated and stored only as inconclusive', () => {
  const { project, runtime } = projectFixture();
  initTask(
    runtime,
    { project, id: 'evidence-shapes', objective: 'Validate evidence', acceptance: ['Proof'] },
    capturedIo(),
  );
  const accept = (evidence: Record<string, unknown>) =>
    updateAcceptance(
      {
        project,
        id: 'evidence-shapes',
        criterion: 'criterion-1',
        status: 'inconclusive',
        evidence: [JSON.stringify(evidence)],
      },
      capturedIo(),
    );

  assert.throws(() => accept([] as unknown as Record<string, unknown>), /JSON object/);
  assert.throws(
    () => accept({ type: 'test', command: 'test', exitCode: 0, injected: true }),
    /Unsupported evidence fields/,
  );
  assert.throws(() => accept({ type: 'test', command: '', exitCode: 0 }), /non-empty string/);
  assert.throws(() => accept({ type: 'test', command: 'test', exitCode: -1 }), /non-negative/);
  assert.throws(
    () => accept({ type: 'file', reference: 'report', artifactDigest: 'sha256:bad' }),
    /artifactDigest/,
  );
  assert.throws(() => accept({ type: 'legacy', reference: 'old' }), /only be migrated/);
  assert.throws(() => accept({ type: 'unknown' }), /Unsupported evidence type/);

  const artifact = accept({
    type: 'diff',
    reference: 'git-diff',
    artifactDigest: `sha256:${'a'.repeat(64)}`,
  });
  assert.equal(artifact.acceptance[0].evidence.at(-1)?.type, 'diff');
  assert.equal(artifact.acceptance[0].evidence.at(-1)?.producer, 'external');
  assert.equal(artifact.acceptance[0].status, 'inconclusive');
  const observed = accept({
    type: 'browser',
    tool: 'browser-runner',
    result: 'verified output',
    host: 'local-test-host',
  });
  assert.equal(observed.acceptance[0].evidence.at(-1)?.type, 'browser');
  assert.equal(observed.acceptance[0].evidence.at(-1)?.producer, 'external');
  assert.equal(observed.acceptance[0].status, 'inconclusive');
});

test('mechanical evidence cannot be copied across task ledgers', () => {
  const { project, runtime } = projectFixture();
  initTask(
    runtime,
    { project, id: 'source-task', objective: 'Produce proof', acceptance: ['Proof'] },
    capturedIo(),
  );
  initTask(
    runtime,
    { project, id: 'target-task', objective: 'Consume proof', acceptance: ['Proof'] },
    capturedIo(),
  );
  const source = verifyTest(project, 'source-task');
  const targetPath = join(project, '.agent-docs', 'working', 'target-task', 'task.json');
  const target = JSON.parse(readFileSync(targetPath, 'utf8'));
  target.acceptance[0].status = 'passed';
  target.acceptance[0].evidence = [source.acceptance[0].evidence[0]];
  writeFileSync(targetPath, `${JSON.stringify(target, null, 2)}\n`);

  assert.throws(
    () => closeTask({ project, id: 'target-task', summary: 'copied proof' }),
    /stale or non-passing evidence/,
  );
});

test('legacy v1 tasks migrate safely and cannot reuse string evidence to close', () => {
  const { project, runtime } = projectFixture();
  const created = initTask(
    runtime,
    { project, id: 'legacy', objective: 'Resume old task', acceptance: ['Verified'] },
    capturedIo(),
  );
  const path = join(project, '.agent-docs', 'working', 'legacy', 'task.json');
  const legacy = {
    ...created,
    schemaVersion: 1,
    acceptance: [
      {
        ...created.acceptance[0],
        status: 'passed',
        evidence: ['test:old-run'],
      },
    ],
    checkpoints: [
      {
        time: created.updated,
        summary: 'Old checkpoint',
        evidence: ['log:old-run'],
      },
    ],
  };
  writeFileSync(path, `${JSON.stringify(legacy, null, 2)}\n`);

  const normalized = taskStatus({ project, id: 'legacy' }, capturedIo());
  assert.equal(Array.isArray(normalized), false);
  if (Array.isArray(normalized)) throw new Error('Expected one task');
  assert.equal(normalized.schemaVersion, 3);
  assert.equal(normalized.acceptance[0].description, 'Verified');
  assert.equal(normalized.acceptance[0].status, 'inconclusive');
  assert.equal(normalized.acceptance[0].evidence[0].type, 'legacy');
  assert.equal(normalized.checkpoints[0].evidence[0].type, 'legacy');
  assert.throws(
    () => closeTask({ project, id: 'legacy', summary: 'Old evidence is enough' }),
    /acceptance is not passed/,
  );

  const updated = verifyTest(project, 'legacy');
  assert.equal(updated.schemaVersion, 3);
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).schemaVersion, 3);
  assert.equal(closeTask({ project, id: 'legacy', summary: 'Fresh evidence' }).status, 'complete');
});

test('legacy v2 evidence migrates every shape as bound non-passing evidence', () => {
  const { project, runtime } = projectFixture();
  const created = initTask(
    runtime,
    { project, id: 'legacy-v2', objective: 'Migrate v2 task', acceptance: ['Verified'] },
    capturedIo(),
  );
  const path = join(project, '.agent-docs', 'working', 'legacy-v2', 'task.json');
  const common = {
    recordedAt: created.updated,
    cwd: project,
    head: created.baseline.head,
    workspaceDigest: null,
  };
  const legacyV2 = {
    ...created,
    schemaVersion: 2,
    acceptance: [
      {
        ...created.acceptance[0],
        status: 'passed',
        evidence: [
          { ...common, type: 'test', command: 'old-test', exitCode: 0 },
          {
            ...common,
            type: 'file',
            reference: 'old.txt',
            artifactDigest: `sha256:${'a'.repeat(64)}`,
          },
          { ...common, type: 'browser', tool: 'old-browser', result: 'observed', host: 'old-host' },
          { ...common, type: 'legacy', reference: 'old-log' },
        ],
      },
    ],
    checkpoints: [
      {
        time: created.updated,
        summary: 'Old observation',
        evidence: [{ ...common, type: 'observation', tool: 'human', result: 'reviewed' }],
      },
    ],
  };
  writeFileSync(path, `${JSON.stringify(legacyV2, null, 2)}\n`);

  const normalized = taskStatus({ project, id: 'legacy-v2' }, capturedIo());
  if (Array.isArray(normalized)) throw new Error('Expected one task');
  assert.equal(normalized.schemaVersion, 3);
  assert.equal(normalized.acceptance[0].status, 'inconclusive');
  assert.deepEqual(
    normalized.acceptance[0].evidence.map(({ type, producer, taskId, criterionId }) => ({
      type,
      producer,
      taskId,
      criterionId,
    })),
    ['test', 'file', 'browser', 'legacy'].map((type) => ({
      type,
      producer: type === 'legacy' ? 'legacy' : 'external',
      taskId: 'legacy-v2',
      criterionId: 'criterion-1',
    })),
  );
  assert.equal(normalized.checkpoints[0].evidence[0].criterionId, null);
});

test('transitional v3 string evidence is recovered as non-passing legacy evidence', () => {
  const { project, runtime } = projectFixture();
  const created = initTask(
    runtime,
    { project, id: 'transitional-v3', objective: 'Resume transitional task', acceptance: ['Safe'] },
    capturedIo(),
  );
  const path = join(project, '.agent-docs', 'working', 'transitional-v3', 'task.json');
  const transitional = {
    ...created,
    checkpoints: [
      {
        time: created.updated,
        summary: 'Written by the transitional v3 implementation',
        evidence: ['test:old-run'],
      },
    ],
  };
  writeFileSync(path, `${JSON.stringify(transitional, null, 2)}\n`);

  const normalized = taskStatus({ project, id: 'transitional-v3' }, capturedIo());
  if (Array.isArray(normalized)) throw new Error('Expected one task');
  assert.equal(normalized.schemaVersion, 3);
  assert.equal(normalized.checkpoints[0].evidence[0].type, 'legacy');
  assert.equal(normalized.checkpoints[0].evidence[0].producer, 'legacy');
  assert.equal(normalized.checkpoints[0].evidence[0].verificationPassed, false);
  assert.equal(normalized.checkpoints[0].evidence[0].criterionId, null);
});

test('task status validates malformed task schemas for direct and list reads', () => {
  const { project, runtime } = projectFixture();
  initTask(
    runtime,
    { project, id: 'malformed', objective: 'Reject bad ledgers', acceptance: ['Valid schema'] },
    capturedIo(),
  );
  const path = join(project, '.agent-docs', 'working', 'malformed', 'task.json');
  const malformed = JSON.parse(readFileSync(path, 'utf8'));
  malformed.acceptance[0].description = '';
  writeFileSync(path, `${JSON.stringify(malformed, null, 2)}\n`);

  assert.throws(
    () => taskStatus({ project, id: 'malformed' }, capturedIo()),
    /Invalid task schema/,
  );
  assert.throws(() => taskStatus({ project }, capturedIo()), /Invalid task schema/);
});

test('close rejects evidence recorded at an older HEAD and reports baseline drift', () => {
  const { project, runtime } = projectFixture();
  writeFileSync(join(project, 'work.txt'), 'baseline\n');
  const baselineHead = commit(project, 'baseline');
  const task = initTask(
    runtime,
    { project, id: 'head-drift', objective: 'Verify current revision', acceptance: ['Tests'] },
    capturedIo(),
  );
  assert.equal(task.baseline.head, baselineHead);
  verifyTest(project, 'head-drift', 'work.txt');
  const freshIo = capturedIo();
  taskStatus({ project, id: 'head-drift', json: true }, freshIo);
  assert.equal(JSON.parse(freshIo.logs[0]).acceptance[0].stale, false);
  writeFileSync(join(project, 'work.txt'), 'changed\n');
  const currentHead = commit(project, 'change revision');

  const statusIo = capturedIo();
  taskStatus({ project, id: 'head-drift', json: true }, statusIo);
  const summary = JSON.parse(statusIo.logs[0]);
  assert.equal(summary.baselineDrift.head, true);
  assert.equal(summary.baselineDrift.currentHead, currentHead);
  assert.equal(summary.acceptance[0].status, 'passed');
  assert.equal(summary.acceptance[0].stale, true);
  const humanStatusIo = capturedIo();
  taskStatus({ project, id: 'head-drift' }, humanStatusIo);
  assert.match(humanStatusIo.logs.join('\n'), /Baseline drift: head/);
  assert.match(humanStatusIo.logs.join('\n'), /criterion-1 \| passed \| stale/);
  assert.throws(
    () => closeTask({ project, id: 'head-drift', summary: 'Stale verification' }),
    /stale or non-passing evidence: criterion-1/,
  );

  verifyTest(project, 'head-drift', 'work.txt');
  assert.equal(
    closeTask({ project, id: 'head-drift', summary: 'Current verification' }).status,
    'complete',
  );
});

test('close rejects evidence after uncommitted workspace content changes', () => {
  const { project, runtime } = projectFixture();
  writeFileSync(join(project, 'work.txt'), 'baseline\n');
  commit(project, 'baseline');
  initTask(
    runtime,
    {
      project,
      id: 'workspace-drift',
      objective: 'Verify exact workspace state',
      acceptance: ['Tests'],
    },
    capturedIo(),
  );
  const accepted = verifyTest(project, 'workspace-drift', 'work.txt');
  assert.match(accepted.acceptance[0].evidence[0].workspaceDigest || '', /^sha256:[0-9a-f]{64}$/);

  writeFileSync(join(project, 'work.txt'), 'changed but not committed\n');
  assert.throws(
    () => closeTask({ project, id: 'workspace-drift', summary: 'Stale workspace' }),
    /stale or non-passing evidence/,
  );

  verifyTest(project, 'workspace-drift', 'work.txt');
  assert.equal(
    closeTask({ project, id: 'workspace-drift', summary: 'Current workspace verified' }).status,
    'complete',
  );
});

test('workspace evidence detects staged-content drift even when status and worktree text match', () => {
  const { project, runtime } = projectFixture();
  const path = join(project, 'work.txt');
  writeFileSync(path, 'baseline\n');
  commit(project, 'baseline');
  writeFileSync(path, 'index-one\n');
  execFileSync('git', ['-C', project, 'add', 'work.txt']);
  writeFileSync(path, 'shared-worktree\n');
  initTask(
    runtime,
    { project, id: 'index-drift', objective: 'Track index state', acceptance: ['Tests'] },
    capturedIo(),
  );
  verifyTest(project, 'index-drift', 'work.txt');

  writeFileSync(path, 'index-two\n');
  execFileSync('git', ['-C', project, 'add', 'work.txt']);
  writeFileSync(path, 'shared-worktree\n');
  assert.throws(
    () => closeTask({ project, id: 'index-drift', summary: 'Stale index evidence' }),
    /stale or non-passing evidence/,
  );
});

test('non-Git tasks use null HEAD evidence without false drift failures', () => {
  const project = mkdtempSync(join(tmpdir(), 'harness-task-nongit-'));
  onTestFinished(() => rmSync(project, { recursive: true, force: true }));
  writeFileSync(join(project, 'verification.txt'), 'verification scope\n');
  const runtime = harnessRuntime(project);
  const task = initTask(
    runtime,
    { project, id: 'non-git', objective: 'Support folders', acceptance: ['Observed'] },
    capturedIo(),
  );
  assert.equal(task.baseline.head, null);
  const accepted = verifyTest(project, 'non-git');
  assert.equal(accepted.acceptance[0].evidence[0].head, null);
  assert.equal(closeTask({ project, id: 'non-git', summary: 'Observed' }).status, 'complete');
});
