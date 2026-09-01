import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import lockfile from 'proper-lockfile';
import { onTestFinished, test } from 'vitest';
import { initProject } from '../commands/init.js';
import { curateMemory } from '../commands/memory-curation.js';
import { captureFinding } from '../commands/memory-finding.js';
import { captureInput } from '../commands/memory-input.js';
import { supersedeMemory } from '../commands/memory-lifecycle.js';
import { initTask } from '../commands/task.js';
import { applyMemoryCuration, curationApplyLockRoot } from '../program/memory-curation-apply.js';
import { capturedIo, harnessRuntime } from './helpers/harness.js';

function fixture(taskId = 'curation-apply-lock-task') {
  const root = mkdtempSync(join(tmpdir(), 'harness-curation-apply-lock-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, 'project');
  mkdirSync(project, { recursive: true });
  execFileSync('git', ['-C', project, 'init', '-q']);
  const runtime = harnessRuntime(root);
  initProject(runtime, project, capturedIo());
  initTask(
    runtime,
    { project, id: taskId, objective: 'Apply curation', acceptance: ['Independent gate'] },
    capturedIo(),
  );
  return { project, runtime, taskId };
}

test('curation apply is serialized by a project-scoped lock', () => {
  const { project, runtime, taskId } = fixture();
  captureInput(
    runtime,
    project,
    {
      title: 'Locked input',
      content: 'Concurrent curation apply must fail closed.',
      source: 'chat',
      mode: 'verbatim',
      purpose: 'constraint',
      retention: 'workstream',
      workstream: taskId,
    },
    capturedIo(),
  );
  const proposal = curateMemory(
    runtime,
    project,
    { task: taskId, outcome: 'workstream-complete' },
    capturedIo(),
  ).closeCandidates[0];
  const lockRoot = curationApplyLockRoot(runtime, project);
  mkdirSync(lockRoot, { recursive: true });
  assert.equal(
    createHash('sha256').update(project).digest('hex').startsWith(basename(lockRoot)),
    true,
  );
  const release = lockfile.lockSync(lockRoot, { realpath: false, retries: 0 });
  try {
    assert.throws(
      () =>
        applyMemoryCuration(
          runtime,
          project,
          { task: taskId, outcome: 'workstream-complete' },
          [{ proposalId: proposal.proposalId }],
          capturedIo(),
        ),
      /being updated by another process/i,
    );
  } finally {
    release();
  }
  assert.equal(existsSync(`${lockRoot}.lock`), false);
});

test('curation apply rejects duplicate and oversized selections before mutation', () => {
  const { project, runtime, taskId } = fixture();
  const proposalId = `sha256:${'a'.repeat(64)}`;
  assert.throws(
    () =>
      applyMemoryCuration(
        runtime,
        project,
        { task: taskId },
        [{ proposalId }, { proposalId }],
        capturedIo(),
      ),
    /unique/i,
  );
  assert.throws(
    () =>
      applyMemoryCuration(
        runtime,
        project,
        { task: taskId },
        Array.from({ length: 17 }, (_, index) => ({
          proposalId: `sha256:${index.toString(16).padStart(64, '0')}`,
        })),
        capturedIo(),
      ),
    /between 1 and 16/i,
  );
});

test('curation apply preserves typed supersession cycle checks', () => {
  const { project, runtime, taskId } = fixture();
  const source = captureFinding(
    runtime,
    project,
    {
      kind: 'analysis',
      retention: 'durable',
      factClass: 'settled-fact',
      title: 'Cycle source',
      conclusion: 'This source has an authoritative reference.',
      rationale: 'Cycle checks remain in the typed lifecycle.',
      application: 'Reject cyclic replacement selections.',
      evidence: ['Verified source evidence.'],
      sourceRefs: [`task:${taskId}`, 'docs/cycle.md'],
    },
    capturedIo(),
  );
  const replacement = captureFinding(
    runtime,
    project,
    {
      kind: 'analysis',
      retention: 'durable',
      factClass: 'settled-fact',
      title: 'Cycle replacement',
      conclusion: 'This replacement points back to the source.',
      rationale: 'The lifecycle command owns graph validation.',
      application: 'Keep the graph acyclic.',
      evidence: ['Verified replacement evidence.'],
      sourceRefs: [`task:${taskId}`],
    },
    capturedIo(),
  );
  supersedeMemory(runtime, project, replacement.reference, source.reference, capturedIo());
  const proposal = curateMemory(runtime, project, { task: taskId }, capturedIo())
    .supersedeCandidates[0];

  const result = applyMemoryCuration(
    runtime,
    project,
    { task: taskId },
    [{ proposalId: proposal.proposalId, replacement: replacement.reference }],
    capturedIo(),
  );

  assert.equal(result.status, 'failed');
  assert.match(result.items[0].reason, /cycle/i);
  assert.match(readFileSync(source.path, 'utf8'), /status: active/);
});
