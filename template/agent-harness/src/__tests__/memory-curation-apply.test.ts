import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { initProject } from '../commands/init.js';
import { type CurationApplySelection, curateMemory } from '../commands/memory-curation.js';
import { captureFinding } from '../commands/memory-finding.js';
import { captureInput } from '../commands/memory-input.js';
import { initTask } from '../commands/task.js';
import { digestPath } from '../lib/files.js';
import { readTask } from '../lib/task-store.js';
import { applyMemoryCuration, memoryCuration } from '../program/memory-curation-apply.js';
import { capturedIo, harnessRuntime } from './helpers/harness.js';

function fixture(taskId = 'curation-apply-task') {
  const root = mkdtempSync(join(tmpdir(), 'harness-curation-apply-'));
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
  return { root, project, runtime, taskId, memoryRoot: join(project, '.agent-docs') };
}

function proposals(report: ReturnType<typeof curateMemory>) {
  return [
    ...report.promoteCandidates,
    ...report.closeCandidates,
    ...report.supersedeCandidates,
    ...report.archiveCandidates,
  ];
}

test('curation proposals have stable content identity and diagnosis remains read-only', () => {
  const { project, runtime, taskId, memoryRoot } = fixture();
  captureInput(
    runtime,
    project,
    {
      title: 'Bounded input',
      content: 'Close only after explicit selection.',
      source: 'chat',
      mode: 'verbatim',
      purpose: 'constraint',
      retention: 'workstream',
      workstream: taskId,
    },
    capturedIo(),
  );
  const before = digestPath(memoryRoot);

  const first = curateMemory(
    runtime,
    project,
    { task: taskId, outcome: 'workstream-complete' },
    capturedIo(),
  );
  const second = curateMemory(
    runtime,
    project,
    { task: taskId, outcome: 'workstream-complete' },
    capturedIo(),
  );

  assert.equal(digestPath(memoryRoot), before);
  assert.deepEqual(proposals(first), proposals(second));
  assert.equal(first.mode, 'proposal-only');
  assert.match(first.closeCandidates[0].proposalId, /^sha256:[0-9a-f]{64}$/);
  assert.match(first.closeCandidates[0].sourceDigest, /^sha256:[0-9a-f]{64}$/);
  assert.match(first.closeCandidates[0].expiresOn, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(first.closeCandidates[0].action, 'close');
});

test('explicit curation close applies through the typed command and replay fails closed', () => {
  const { project, runtime, taskId } = fixture();
  const input = captureInput(
    runtime,
    project,
    {
      title: 'Selected input',
      content: 'Close this selected workstream input.',
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

  const result = applyMemoryCuration(
    runtime,
    project,
    { task: taskId, outcome: 'workstream-complete' },
    [{ proposalId: proposal.proposalId }],
    capturedIo(),
  );

  assert.equal(result.status, 'passed');
  assert.equal(result.items[0].validation.status, 'passed');
  assert.match(readFileSync(input.path, 'utf8'), /status: complete/);
  assert.match(readFileSync(input.path, 'utf8'), /close-reason: workstream-complete/);
  assert.equal(readTask(project, taskId).value.status, 'in_progress');
  assert.equal(result.remainingValidation.status, 'passed');
  assert.ok(
    !result.remainingProposals.some(({ proposalId }) => proposalId === proposal.proposalId),
  );

  const replay = applyMemoryCuration(
    runtime,
    project,
    { task: taskId, outcome: 'workstream-complete' },
    [{ proposalId: proposal.proposalId }],
    capturedIo(),
  );
  assert.equal(replay.status, 'failed');
  assert.equal(replay.items[0].validation.status, 'failed');
  assert.match(replay.items[0].reason, /stale|changed|expired/i);
});

test('source drift invalidates an exact proposal without overwriting the changed memory', () => {
  const { project, runtime, taskId } = fixture();
  const input = captureInput(
    runtime,
    project,
    {
      title: 'Drifting input',
      content: 'Original user content.',
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
  writeFileSync(input.path, `${readFileSync(input.path, 'utf8')}\nConcurrent user note.\n`);

  const result = applyMemoryCuration(
    runtime,
    project,
    { task: taskId, outcome: 'workstream-complete' },
    [{ proposalId: proposal.proposalId }],
    capturedIo(),
  );

  assert.equal(result.status, 'failed');
  assert.match(result.items[0].reason, /stale|changed|expired/i);
  assert.match(readFileSync(input.path, 'utf8'), /Concurrent user note/);
  assert.match(readFileSync(input.path, 'utf8'), /status: active/);
});

test('authoritative workspace drift and proposal expiry both require regeneration', () => {
  const { root, project, runtime, taskId } = fixture();
  const input = captureInput(
    runtime,
    project,
    {
      title: 'Workspace-bound input',
      content: 'The proposal is bound to the authoritative workspace.',
      source: 'chat',
      mode: 'verbatim',
      purpose: 'constraint',
      retention: 'workstream',
      workstream: taskId,
    },
    capturedIo(),
  );
  const options = { task: taskId, outcome: 'workstream-complete' as const };
  const proposal = curateMemory(runtime, project, options, capturedIo()).closeCandidates[0];
  writeFileSync(join(project, 'README.md'), '# Concurrent authoritative change\n');

  const drifted = applyMemoryCuration(
    runtime,
    project,
    options,
    [{ proposalId: proposal.proposalId }],
    capturedIo(),
  );

  assert.equal(drifted.status, 'failed');
  assert.match(drifted.items[0].reason, /stale|changed|expired/i);
  assert.match(readFileSync(input.path, 'utf8'), /status: active/);
  rmSync(join(project, 'README.md'));
  const futureRuntime = harnessRuntime(root, {
    env: { HOME: runtime.home, TZ: 'Pacific/Kiritimati' },
  });
  const futureProposal = curateMemory(futureRuntime, project, options, capturedIo())
    .closeCandidates[0];
  assert.notEqual(futureProposal.expiresOn, proposal.expiresOn);

  const expired = applyMemoryCuration(
    runtime,
    project,
    options,
    [{ proposalId: futureProposal.proposalId }],
    capturedIo(),
  );

  assert.equal(expired.status, 'failed');
  assert.match(expired.items[0].reason, /stale|changed|expired/i);
  assert.match(readFileSync(input.path, 'utf8'), /status: active/);
});

test('bounded batches report partial failure without undoing independently verified items', () => {
  const { project, runtime, taskId } = fixture();
  const input = captureInput(
    runtime,
    project,
    {
      title: 'Batch input',
      content: 'This close can complete independently.',
      source: 'chat',
      mode: 'verbatim',
      purpose: 'constraint',
      retention: 'workstream',
      workstream: taskId,
    },
    capturedIo(),
  );
  captureFinding(
    runtime,
    project,
    {
      kind: 'analysis',
      retention: 'durable',
      factClass: 'settled-fact',
      title: 'Settled curation fact',
      conclusion: 'The formal document already carries this conclusion.',
      rationale: 'Typed supersession remains explicit.',
      application: 'Use the authoritative document after owner review.',
      evidence: ['Verified fixture evidence.'],
      sourceRefs: [`task:${taskId}`, 'docs/settled.md'],
    },
    capturedIo(),
  );
  const report = curateMemory(
    runtime,
    project,
    { task: taskId, outcome: 'workstream-complete' },
    capturedIo(),
  );
  const close = report.closeCandidates[0];
  const supersede = report.supersedeCandidates[0];
  const selections: CurationApplySelection[] = [
    { proposalId: close.proposalId },
    { proposalId: supersede.proposalId },
  ];

  const result = applyMemoryCuration(
    runtime,
    project,
    { task: taskId, outcome: 'workstream-complete' },
    selections,
    capturedIo(),
  );

  assert.equal(result.status, 'partial');
  assert.equal(result.items[0].validation.status, 'passed');
  assert.equal(result.items[1].validation.status, 'failed');
  assert.match(result.items[1].reason, /replacement/i);
  assert.match(readFileSync(input.path, 'utf8'), /status: complete/);
  assert.ok(result.remainingProposals.some(({ action }) => action === 'supersede'));
});

test('promotion selection delegates to the formal proposal flow and never writes its target', () => {
  const { project, runtime, taskId } = fixture();
  captureFinding(
    runtime,
    project,
    {
      kind: 'analysis',
      retention: 'durable',
      factClass: 'settled-fact',
      title: 'Promote this finding',
      conclusion: 'Promotion remains proposal-first.',
      rationale: 'Formal writes require separate authorization.',
      application: 'Review this finding with the documentation owner.',
      evidence: ['Verified fixture evidence.'],
      sourceRefs: [`task:${taskId}`],
    },
    capturedIo(),
  );
  const candidate = curateMemory(runtime, project, { task: taskId }, capturedIo())
    .promoteCandidates[0];
  const target = join(project, 'docs', 'promoted.md');

  const result = applyMemoryCuration(
    runtime,
    project,
    { task: taskId },
    [
      {
        proposalId: candidate.proposalId,
        promotion: {
          target: 'docs/promoted.md',
          artifactType: 'docs',
          owner: 'docs-owner',
          reason: 'Review durable evidence',
          verifier: 'pnpm run check:docs',
        },
      },
    ],
    capturedIo(),
  );

  assert.equal(result.status, 'passed');
  assert.equal(result.items[0].action, 'promote');
  assert.equal(result.items[0].validation.status, 'passed');
  assert.ok(result.items[0].result && 'mode' in result.items[0].result);
  assert.equal(result.items[0].result.mode, 'proposal-only');
  assert.equal(digestPath(target), null);
});

test('curation command requires confirmation and accepts a bounded typed selection file', () => {
  const { root, project, runtime, taskId } = fixture();
  const input = captureInput(
    runtime,
    project,
    {
      title: 'Selection file input',
      content: 'The selection file identifies this exact proposal.',
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
  const selectionFile = join(root, 'curation-selection.json');
  writeFileSync(
    selectionFile,
    `${JSON.stringify({ version: 1, selections: [{ proposalId: proposal.proposalId }] })}\n`,
  );
  assert.throws(
    () =>
      memoryCuration(
        runtime,
        project,
        { task: taskId, outcome: 'workstream-complete', applyFile: selectionFile },
        capturedIo(),
      ),
    /requires explicit --yes/i,
  );
  assert.match(readFileSync(input.path, 'utf8'), /status: active/);

  const applied = memoryCuration(
    runtime,
    project,
    { task: taskId, outcome: 'workstream-complete', applyFile: selectionFile, yes: true },
    capturedIo(),
  );

  assert.equal(applied.mode, 'applied');
  assert.match(readFileSync(input.path, 'utf8'), /status: complete/);
  assert.throws(
    () =>
      memoryCuration(
        runtime,
        project,
        {
          task: taskId,
          apply: [proposal.proposalId],
          applyFile: selectionFile,
          yes: true,
        },
        capturedIo(),
      ),
    /cannot be combined/i,
  );
});
