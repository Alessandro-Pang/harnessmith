import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { initProject } from '../commands/init.js';
import { memoryCheck } from '../commands/memory/memory.js';
import { initTask, taskStatus } from '../commands/task/task.js';
import { assertHandoffSessionId } from '../lib/memory/memory-handoff-identity.js';
import { validatePortableMemoryPaths } from '../lib/memory/memory-root-path-rules.js';
import { canonicalTaskLedgerId } from '../lib/task/task-ledger-memory.js';
import { capturedIo, harnessRuntime } from './helpers/harness.js';

function fixture(): {
  root: string;
  project: string;
  runtime: ReturnType<typeof harnessRuntime>;
} {
  const root = mkdtempSync(join(tmpdir(), 'harness-portable-identity-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, 'project');
  mkdirSync(project);
  execFileSync('git', ['-C', project, 'init', '-q']);
  return { root, project, runtime: harnessRuntime(root) };
}

function memoryDocument(title: string): string {
  return `---
title: ${title}
description: Portable path fixture
type: decision
memory-kind: distilled
status: active
owners: [test-owner]
created: 2026-08-25
updated: 2026-08-25
project: project
tags: [test]
scope: []
source-refs: []
source-of-truth: false
schema-version: 1
---
`;
}

function taskLedgerMetadata(id: string): Map<string, unknown> {
  return new Map<string, unknown>([
    ['type', 'working-note'],
    ['memory-kind', 'working'],
    ['tags', ['task-ledger']],
    ['source-refs', [`task:${id}`]],
  ]);
}

test('task init enforces the portable identity boundary before initializing project memory', () => {
  const { project, runtime } = fixture();
  const invalidIds = [
    'a'.repeat(101),
    'con',
    'prn.report',
    'aux',
    'nul',
    'com1',
    'lpt9.task',
    'trailing.',
    'trailing ',
  ];

  for (const id of invalidIds) {
    assert.throws(
      () =>
        initTask(
          runtime,
          { project, id, objective: 'Reject a non-portable task id', acceptance: ['Rejected'] },
          capturedIo(),
        ),
      /invalid task id/i,
      id,
    );
  }
  assert.equal(existsSync(join(project, '.agent-docs')), false);

  const boundaryId = 'a'.repeat(100);
  const task = initTask(
    runtime,
    { project, id: boundaryId, objective: 'Accept the boundary', acceptance: ['Accepted'] },
    capturedIo(),
  );
  assert.equal(task.id, boundaryId);
  const loaded = taskStatus({ project, id: boundaryId }, capturedIo());
  assert.equal(Array.isArray(loaded) ? undefined : loaded.id, boundaryId);
});

test('task status preserves read compatibility for safe pre-portable task ids', () => {
  const { project, runtime } = fixture();
  const source = initTask(
    runtime,
    {
      project,
      id: 'legacy-source',
      objective: 'Read an existing task after upgrade',
      acceptance: ['Existing state remains readable'],
    },
    capturedIo(),
  );
  const legacyIds = [
    'l'.repeat(101),
    ...(process.platform === 'win32' ? [] : ['con', 'aux.report', 'trailing.']),
  ];

  for (const id of legacyIds) {
    const directory = join(project, '.agent-docs', 'working', id);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'task.json'), `${JSON.stringify({ ...source, id }, null, 2)}\n`);

    const loaded = taskStatus({ project, id }, capturedIo());
    assert.equal(Array.isArray(loaded) ? undefined : loaded.id, id);
  }
});

test('task schema still rejects unsafe identities outside the legacy lexical contract', () => {
  const { project, runtime } = fixture();
  const task = initTask(
    runtime,
    { project, id: 'schema-source', objective: 'Validate stored identity', acceptance: ['Valid'] },
    capturedIo(),
  );
  const path = join(project, '.agent-docs', 'working', task.id, 'task.json');
  const baseline = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;

  for (const id of ['', 'Uppercase', '.leading', '-leading', 'path/escape']) {
    writeFileSync(path, `${JSON.stringify({ ...baseline, id }, null, 2)}\n`);
    assert.throws(
      () => taskStatus({ project, id: task.id }, capturedIo()),
      /invalid task schema/i,
      id,
    );
  }
});

test('canonical task-ledger paths use the same task identity predicate', () => {
  const { root } = fixture();
  const memoryRoot = join(root, 'memory-root');
  const boundaryId = 'c'.repeat(100);
  assert.equal(
    canonicalTaskLedgerId(
      memoryRoot,
      join(memoryRoot, 'working', boundaryId, 'progress.md'),
      taskLedgerMetadata(boundaryId),
    ),
    boundaryId,
  );

  for (const id of ['d'.repeat(101), 'con', 'prn.report', 'trailing.', 'trailing ']) {
    assert.equal(
      canonicalTaskLedgerId(
        memoryRoot,
        join(memoryRoot, 'working', id, 'progress.md'),
        taskLedgerMetadata(id),
      ),
      undefined,
      id,
    );
  }
});

test('managed memory validates every portable path component without changing collision identity', () => {
  const { root } = fixture();
  const memoryRoot = join(root, 'memory-root');
  const invalidEntries = [
    join(memoryRoot, 'con.md'),
    join(memoryRoot, 'nested.', 'memory.md'),
    join(memoryRoot, 'nested ', 'memory.md'),
    join(memoryRoot, 'bad:name.md'),
    join(memoryRoot, `${'e'.repeat(256)}.md`),
    join(memoryRoot, `${'é'.repeat(128)}.md`),
  ];
  const io = capturedIo();

  assert.equal(
    validatePortableMemoryPaths(
      memoryRoot,
      invalidEntries.map((path) => ({ path, kind: 'file' })),
      io,
    ),
    invalidEntries.length,
  );
  assert.equal(io.errors.length, invalidEntries.length);
  assert.equal(
    io.errors.every((message) => /non-portable path component/i.test(message)),
    true,
  );

  const validBoundary = capturedIo();
  assert.equal(
    validatePortableMemoryPaths(
      memoryRoot,
      [{ path: join(memoryRoot, 'e'.repeat(255)), kind: 'file' }],
      validBoundary,
    ),
    0,
  );
  assert.deepEqual(validBoundary.errors, []);

  const collisions = capturedIo();
  assert.equal(
    validatePortableMemoryPaths(
      memoryRoot,
      [
        { path: join(memoryRoot, 'CASE.md'), kind: 'file' },
        { path: join(memoryRoot, 'case.md'), kind: 'file' },
        { path: join(memoryRoot, 'café.md'), kind: 'file' },
        { path: join(memoryRoot, 'café.md'), kind: 'file' },
      ],
      collisions,
    ),
    2,
  );
  assert.equal(
    collisions.errors.every((message) => /portable memory path collision/i.test(message)),
    true,
  );
});

test.skipIf(process.platform === 'win32')(
  'memory root validation rejects a managed Windows device basename',
  () => {
    const { project, runtime } = fixture();
    initProject(runtime, project, capturedIo());
    writeFileSync(join(project, '.agent-docs', 'con.md'), memoryDocument('Non-portable path'));
    const io = capturedIo();

    assert.throws(() => memoryCheck(runtime, project, io), /issue/i);
    assert.match(io.errors.join('\n'), /non-portable path component/i);
  },
);

test('handoff session ids retain the shared portable identity length and filename rules', () => {
  assert.doesNotThrow(() => assertHandoffSessionId('s'.repeat(100)));
  for (const session of ['s'.repeat(101), 'con', 'aux.report', 'trailing.', 'trailing ']) {
    assert.throws(() => assertHandoffSessionId(session), /invalid portable session id/i, session);
  }
});
