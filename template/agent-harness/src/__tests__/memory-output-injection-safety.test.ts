import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { initProject } from '../commands/init.js';
import { memoryList } from '../commands/memory/memory.js';
import { memoryMaintenance } from '../commands/memory/memory-maintenance.js';
import { capturedIo, harnessRuntime } from './helpers/harness.js';

function memoryDocument(title: string): string {
  return `---
title: ${title}
description: ${title} memory
type: session-handoff
memory-kind: episode
status: active
owners: [test-owner]
created: 2026-08-19
updated: 2026-08-19
project: test
tags: [test]
scope: []
source-refs: []
source-of-truth: false
schema-version: 1
---
`;
}

test('memory titles and managed paths cannot inject forged output lines', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-memory-output-injection-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, 'project');
  mkdirSync(project, { recursive: true });
  execFileSync('git', ['-C', project, 'init', '-q']);
  const runtime = harnessRuntime(root);
  initProject(runtime, project, capturedIo());
  const memoryRoot = join(project, '.agent-docs');
  const titlePath = join(memoryRoot, 'unsafe-title.md');
  writeFileSync(
    titlePath,
    memoryDocument('Safe').replace(
      'title: Safe',
      'title: "Safe\\nFORGED | input | active | 2026-08-25"',
    ),
  );

  let output = capturedIo();
  assert.throws(() => memoryList(runtime, project, output), /memory check failed/i);
  assert.equal(output.logs.length, 0);
  assert.equal(
    output.errors.every((message) => !message.includes('\n')),
    true,
  );

  rmSync(titlePath);
  if (process.platform === 'win32') return;
  writeFileSync(join(memoryRoot, 'unsafe\nFORGED.md'), memoryDocument('Safe path title'));
  output = capturedIo();
  assert.throws(() => memoryMaintenance(runtime, project, {}, output), /memory check failed/i);
  assert.equal(output.logs.length, 0);
  assert.equal(
    output.errors.every((message) => !message.includes('\n')),
    true,
  );
  assert.match(output.errors.join('\n'), /unsafe control or display-format characters/i);
});
