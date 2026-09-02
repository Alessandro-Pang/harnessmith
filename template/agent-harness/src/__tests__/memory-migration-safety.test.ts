import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { initGlobal, initProject } from '../commands/init.js';
import { memoryMigrate } from '../commands/memory/memory-migration.js';
import { maximumMemoryDocumentBytes } from '../lib/memory/memory-path.js';
import { assertMode, capturedIo, harnessRuntime } from './helpers/harness.js';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'harness-memory-migration-safety-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  return harnessRuntime(root);
}

function projectFixture() {
  const root = mkdtempSync(join(tmpdir(), 'harness-memory-migration-warning-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, 'project');
  mkdirSync(project, { recursive: true });
  execFileSync('git', ['-C', project, 'init', '-q']);
  return { project, runtime: harnessRuntime(root) };
}

function workingDocument(): string {
  return `---
title: Working note
description: Working note before migration
type: working-note
memory-kind: working
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

Working body.
`;
}

test('global profile migration preserves its private file mode', () => {
  const runtime = fixture();
  initGlobal(runtime, capturedIo());
  const profile = join(runtime.memoryHome, 'profile.md');
  chmodSync(profile, 0o600);

  const report = memoryMigrate(
    runtime,
    'global',
    'profile',
    JSON.stringify({ description: 'Private profile after migration' }),
    { apply: true },
    capturedIo(),
  );

  assert.equal(report.mode, 'applied');
  assertMode(profile, 0o600);
  assert.match(readFileSync(profile, 'utf8'), /description: Private profile after migration/);
});

test('migration rejects an oversized document before reading its body', () => {
  const runtime = fixture();
  initGlobal(runtime, capturedIo());
  const oversized = join(runtime.memoryHome, 'oversized.md');
  writeFileSync(oversized, '---\ntitle: oversized\n---\n');
  truncateSync(oversized, maximumMemoryDocumentBytes + 1);

  assert.throws(
    () => memoryMigrate(runtime, 'global', 'oversized', '{}', {}, capturedIo()),
    /exceeds .* bytes|byte budget/i,
  );
});

test('working-memory expiry warnings remain non-blocking for proposal and apply', () => {
  const { project, runtime } = projectFixture();
  initProject(runtime, project, capturedIo());
  const source = join(project, '.agent-docs', 'working-note.md');
  writeFileSync(source, workingDocument());

  const proposed = memoryMigrate(
    runtime,
    project,
    'working-note',
    JSON.stringify({ description: 'Working note after migration' }),
    {},
    capturedIo(),
  );
  assert.equal(proposed.ready, true);
  assert.equal(
    proposed.issues.some((issue) => issue.startsWith('WARNING ')),
    true,
  );

  const applied = memoryMigrate(
    runtime,
    project,
    'working-note',
    JSON.stringify({ description: 'Working note after migration' }),
    { apply: true },
    capturedIo(),
  );
  assert.equal(applied.ready, true);
  assert.match(readFileSync(source, 'utf8'), /description: Working note after migration/);
});
