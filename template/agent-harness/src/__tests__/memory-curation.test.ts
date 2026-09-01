import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { initProject } from '../commands/init.js';
import { curateMemory } from '../commands/memory-curation.js';
import { captureFinding } from '../commands/memory-finding.js';
import { captureInput } from '../commands/memory-input.js';
import { initTask } from '../commands/task.js';
import { digestPath } from '../lib/files.js';
import { capturedIo, harnessRuntime } from './helpers/harness.js';

function fixture(taskId = 'curation-task') {
  const root = mkdtempSync(join(tmpdir(), 'harness-curation-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, 'project');
  mkdirSync(project, { recursive: true });
  execFileSync('git', ['-C', project, 'init', '-q']);
  const runtime = harnessRuntime(root);
  initProject(runtime, project, capturedIo());
  initTask(
    runtime,
    { project, id: taskId, objective: 'Curate one task', acceptance: ['Curation is read-only'] },
    capturedIo(),
  );
  return { project, runtime, taskId, memoryRoot: join(project, '.agent-docs') };
}

function writeMemory(
  memoryRoot: string,
  name: string,
  options: {
    status?: 'active' | 'blocked' | 'complete' | 'superseded';
    expires?: string;
    sourceRefs?: string[];
    extra?: string;
  } = {},
) {
  const path = join(memoryRoot, name);
  mkdirSync(dirname(path), { recursive: true });
  const status = options.status ?? 'active';
  writeFileSync(
    path,
    `---\ntitle: ${JSON.stringify(name)}\ndescription: Curation fixture\ntype: working-note\nmemory-kind: working\nstatus: ${status}\nowners: [test-owner]\ncreated: 2026-08-01\nupdated: 2026-08-01\n${options.expires ? `expires: ${options.expires}\n` : 'expires: 2026-09-30\n'}project: project\ntags: [working]\nscope: []\nsource-refs: ${JSON.stringify(options.sourceRefs ?? [])}\nsource-of-truth: false\nschema-version: 1\n${options.extra ?? ''}---\n\n# Curation fixture\n`,
  );
  return path;
}

test('curation returns none for a live task and does not mutate Memory', () => {
  const { project, runtime, taskId, memoryRoot } = fixture();
  const before = digestPath(memoryRoot);
  const report = curateMemory(
    runtime,
    project,
    { task: taskId, outcome: 'phase-complete' },
    capturedIo(),
  );
  assert.equal(report.result, 'none');
  assert.deepEqual(report.promoteCandidates, []);
  assert.deepEqual(report.closeCandidates, []);
  assert.equal(digestPath(memoryRoot), before);
});

test('task completion does not close workstream state, while workstream completion scopes candidates', () => {
  const { project, runtime, taskId, memoryRoot } = fixture();
  captureInput(
    runtime,
    project,
    {
      title: 'Current workstream input',
      content: 'Keep this until the current workstream completes.',
      source: 'chat',
      mode: 'verbatim',
      purpose: 'constraint',
      retention: 'workstream',
      workstream: taskId,
    },
    capturedIo(),
  );
  captureInput(
    runtime,
    project,
    {
      title: 'Parallel workstream input',
      content: 'Keep this for another parallel task.',
      source: 'chat',
      mode: 'verbatim',
      purpose: 'constraint',
      retention: 'workstream',
      workstream: 'parallel-task',
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
      title: 'Typed curation candidate',
      conclusion: 'Curation should propose semantic promotion separately from task closure.',
      rationale: 'Acceptance evidence and durable knowledge have different owners.',
      application: 'Review the finding with a formal-document owner before promotion.',
      evidence: ['The task has a sourced reusable finding.'],
      sourceRefs: [`task:${taskId}`],
    },
    capturedIo(),
  );
  const before = digestPath(memoryRoot);

  const taskComplete = curateMemory(
    runtime,
    project,
    { task: taskId, workstream: taskId, outcome: 'task-complete' },
    capturedIo(),
  );
  assert.equal(taskComplete.closeCandidates.length, 0);
  assert.equal(taskComplete.promoteCandidates.length, 1);
  assert.ok(taskComplete.skipped.some(({ reason }) => /workstream continues/i.test(reason)));

  const workstreamComplete = curateMemory(
    runtime,
    project,
    { task: taskId, workstream: taskId, outcome: 'workstream-complete' },
    capturedIo(),
  );
  assert.equal(workstreamComplete.closeCandidates.length, 1);
  assert.ok(workstreamComplete.closeCandidates[0].reference.includes('inputs/'));
  assert.doesNotMatch(JSON.stringify(workstreamComplete), /Parallel workstream input/);
  assert.equal(digestPath(memoryRoot), before);
});

test('curation handles expired and superseded candidates but blocks active inbound references', () => {
  const { project, runtime, taskId, memoryRoot } = fixture();
  const expired = writeMemory(memoryRoot, 'working/expired.md', {
    expires: '2026-08-01',
    sourceRefs: [`task:${taskId}`],
  });
  writeMemory(memoryRoot, 'distilled/replacement.md', { status: 'active' });
  writeMemory(memoryRoot, 'working/contradicted.md', {
    status: 'superseded',
    sourceRefs: [`task:${taskId}`],
    extra: 'superseded-by: memory:distilled/replacement\n',
  });

  const initial = curateMemory(
    runtime,
    project,
    { task: taskId, outcome: 'task-complete' },
    capturedIo(),
  );
  assert.ok(
    initial.archiveCandidates.some(({ reference }) => reference.endsWith('working/expired')),
  );
  assert.ok(
    initial.archiveCandidates.some(({ reference }) => reference.endsWith('working/contradicted')),
  );

  writeMemory(memoryRoot, 'working/shared-reference.md', {
    sourceRefs: [`task:${taskId}`, 'memory:working/expired'],
  });
  const blocked = curateMemory(
    runtime,
    project,
    { task: taskId, outcome: 'task-complete' },
    capturedIo(),
  );
  assert.ok(
    blocked.skipped.some(
      ({ reference, reason }) =>
        reference.endsWith('working/expired') && /active inbound reference/i.test(reason),
    ),
  );
  assert.ok(
    !blocked.archiveCandidates.some(({ reference }) => reference.endsWith('working/expired')),
  );
  assert.ok(expired.endsWith('expired.md'));
});
