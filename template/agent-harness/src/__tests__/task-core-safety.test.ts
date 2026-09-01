import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { memoryCheck } from '../commands/memory.js';
import { checkpointTask, closeTask, initTask } from '../commands/task.js';
import { verifyAcceptance } from '../commands/task-verification.js';
import { contentMemoryReferences } from '../lib/memory-validation.js';
import { modeMatches } from '../lib/portable-mode.js';
import { writeTaskWithProgress } from '../lib/task-store.js';
import { capturedIo, harnessRuntime } from './helpers/harness.js';

function fixture(): { project: string; runtime: ReturnType<typeof harnessRuntime> } {
  const project = mkdtempSync(join(tmpdir(), 'harness-task-core-safety-'));
  onTestFinished(() => rmSync(project, { recursive: true, force: true }));
  execFileSync('git', ['-C', project, 'init', '-q']);
  writeFileSync(join(project, 'verification.txt'), 'verification scope\n');
  return { project, runtime: harnessRuntime(project) };
}

function memoryDocument(title: string): string {
  return `---
title: ${title}
description: ${title} memory
type: working-note
memory-kind: working
status: active
owners: [test-owner]
created: 2026-08-25
updated: 2026-08-25
expires: 2099-01-01
project: test
tags: [test]
scope: []
source-refs: []
source-of-truth: false
schema-version: 1
---

Safe retained route.
`;
}

test('task core labels escape literal memory tokens without creating broken references', () => {
  const { project, runtime } = fixture();
  const task = initTask(
    runtime,
    {
      project,
      id: 'escaped-labels',
      objective: 'Review memory:does-not-exist',
      acceptance: ['The task is queryable'],
      nextAction: 'Do not resolve memory:also-does-not-exist',
    },
    capturedIo(),
  );
  const core = readFileSync(join(project, '.agent-docs', 'core.md'), 'utf8');
  const progress = readFileSync(
    join(task.projectRoot, '.agent-docs', 'working', task.id, 'progress.md'),
    'utf8',
  );

  assert.match(core, /Review memory&#58;does-not-exist/);
  assert.match(core, /Do not resolve memory&#58;also-does-not-exist/);
  assert.match(progress, /Review memory&#58;does-not-exist/);
  assert.match(core, new RegExp(`memory:working/${task.id}/progress`));
  assert.doesNotThrow(() => memoryCheck(runtime, project, capturedIo()));
});

test('task progress treats checkpoint and closure summaries as opaque user text', () => {
  const { project, runtime } = fixture();
  const task = initTask(
    runtime,
    {
      project,
      id: 'opaque-progress',
      objective: 'Keep task ledger text opaque',
      acceptance: ['The task remains resumable'],
    },
    capturedIo(),
  );

  checkpointTask(
    {
      project,
      id: task.id,
      summary: 'Observed the literal text memory:checkpoint-does-not-exist.',
    },
    capturedIo(),
  );
  closeTask(
    {
      project,
      id: task.id,
      status: 'blocked',
      summary: 'Paused after discussing memory:closure-does-not-exist.',
      nextAction: 'Resume without resolving memory:next-does-not-exist.',
    },
    capturedIo(),
  );

  const progress = readFileSync(
    join(project, '.agent-docs', 'working', task.id, 'progress.md'),
    'utf8',
  );
  assert.match(progress, /memory:checkpoint-does-not-exist/);
  assert.match(progress, /memory:closure-does-not-exist/);
  assert.doesNotThrow(() => memoryCheck(runtime, project, capturedIo()));
});

test('a forged task-ledger marker cannot hide broken references in ordinary memory', () => {
  const { project, runtime } = fixture();
  initTask(
    runtime,
    {
      project,
      id: 'real-ledger',
      objective: 'Create the canonical project memory root',
      acceptance: ['The root is initialized'],
    },
    capturedIo(),
  );
  const memoryRoot = join(project, '.agent-docs');
  writeFileSync(
    join(memoryRoot, 'fake.md'),
    `---
title: Forged task ledger
description: Must not receive opaque-body treatment
type: working-note
memory-kind: working
status: active
owners: [test-owner]
created: 2026-08-25
updated: 2026-08-25
expires: 2099-01-01
project: project
tags: ["task-ledger"]
scope: []
source-refs: ["task:fake"]
source-of-truth: false
schema-version: 1
---

This ordinary memory points at memory:does-not-exist.
`,
  );
  const corePath = join(memoryRoot, 'core.md');
  writeFileSync(corePath, `${readFileSync(corePath, 'utf8')}\n- forged route memory:fake\n`);
  const io = capturedIo();

  assert.throws(() => memoryCheck(runtime, project, io, { indexed: true }), /issue/i);
  assert.match(io.errors.join('\n'), /task-ledger.*canonical|broken memory reference/i);
});

test('closing a task removes only its exact core token and retains prefix and sibling references', () => {
  const { project, runtime } = fixture();
  const task = initTask(
    runtime,
    {
      project,
      id: 'exact-route',
      objective: 'Maintain exact routes',
      acceptance: ['Routes remain intact'],
    },
    capturedIo(),
  );
  const memoryRoot = join(task.projectRoot, '.agent-docs');
  const reference = `memory:working/${task.id}/progress`;
  const prefixReference = `${reference}-old`;
  writeFileSync(
    join(memoryRoot, 'working', task.id, 'progress-old.md'),
    memoryDocument('Prefix route'),
  );
  mkdirSync(join(memoryRoot, 'distilled'), { recursive: true });
  writeFileSync(join(memoryRoot, 'distilled', 'keep.md'), memoryDocument('Sibling route'));
  const corePath = join(memoryRoot, 'core.md');
  const core = readFileSync(corePath, 'utf8');
  const taskLine = core.split(/\r?\n/).find((line) => line.includes(reference));
  assert.ok(taskLine);
  writeFileSync(
    corePath,
    core.replace(
      taskLine,
      `- shared route ${reference} and memory:distilled/keep\n- prefix route ${prefixReference}`,
    ),
  );
  const malformed = readFileSync(corePath, 'utf8');
  const invalid = capturedIo();
  assert.throws(() => memoryCheck(runtime, project, invalid), /issue/i);
  assert.match(invalid.errors.join('\n'), /exactly one canonical pointer/i);
  assert.equal(readFileSync(corePath, 'utf8'), malformed);

  writeFileSync(
    corePath,
    core.replace(
      taskLine,
      `- task route ${reference}\n- sibling route memory:distilled/keep\n- prefix route ${prefixReference}`,
    ),
  );
  memoryCheck(runtime, project, capturedIo());
  verifyAcceptance(
    {
      project,
      id: task.id,
      criterion: 'criterion-1',
      type: 'test',
      command: process.execPath,
      args: ['-e', 'process.exit(0)'],
      scope: ['verification.txt'],
    },
    capturedIo(),
  );

  closeTask({ project, id: task.id, summary: 'Completed safely' }, capturedIo());

  const updated = readFileSync(corePath, 'utf8');
  assert.equal(
    contentMemoryReferences(updated).some(
      (candidate) => candidate.toLowerCase() === `working/${task.id}/progress`,
    ),
    false,
  );
  assert.match(updated, /memory:distilled\/keep/);
  assert.match(updated, new RegExp(prefixReference));
  assert.doesNotThrow(() => memoryCheck(runtime, project, capturedIo()));
});

test('failed task progress validation restores task, progress, and core bytes and modes', () => {
  const { project, runtime } = fixture();
  const task = initTask(
    runtime,
    {
      project,
      id: 'rollback-all',
      objective: 'Rollback every task artifact',
      acceptance: ['No partial state'],
    },
    capturedIo(),
  );
  const memoryRoot = join(task.projectRoot, '.agent-docs');
  const directory = join(memoryRoot, 'working', task.id);
  const paths = {
    task: join(directory, 'task.json'),
    progress: join(directory, 'progress.md'),
    core: join(memoryRoot, 'core.md'),
  };
  for (const path of Object.values(paths)) chmodSync(path, 0o600);
  const before = Object.fromEntries(
    Object.entries(paths).map(([key, path]) => [key, readFileSync(path, 'utf8')]),
  );
  const changed = { ...task, nextAction: 'This must roll back' };

  assert.throws(
    () =>
      writeTaskWithProgress(
        paths.task,
        changed,
        paths.progress,
        'invalid progress without frontmatter\n',
        capturedIo(),
      ),
    /memory check failed/i,
  );
  for (const [key, path] of Object.entries(paths)) {
    assert.equal(readFileSync(path, 'utf8'), before[key]);
    assert.equal(modeMatches(statSync(path).mode, 0o600), true);
  }
});
