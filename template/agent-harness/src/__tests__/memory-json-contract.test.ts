import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { runCli } from '../cli.js';
import { initGlobal, initProject } from '../commands/init.js';
import { type CapturedIo, capturedIo, harnessRuntime } from './helpers/harness.js';

function warningMemory(project: string): string {
  return `---
title: Working note
description: Valid working memory without an expiry
type: working-note
memory-kind: working
status: active
owners: [test-owner]
created: 2026-08-25
updated: 2026-08-25
project: ${project}
tags: [working]
scope: []
source-refs: []
source-of-truth: false
schema-version: 1
---

# Working note
`;
}

function assertSingleJson(io: CapturedIo): void {
  assert.equal(io.logs.length, 1);
  assert.doesNotThrow(() => JSON.parse(io.logs[0]));
  assert.match(io.errors.join('\n'), /WARNING Working memory should declare expires/);
}

test('JSON memory commands keep warnings off stdout', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-memory-json-contract-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, 'project');
  mkdirSync(project, { recursive: true });
  execFileSync('git', ['-C', project, 'init', '-q']);
  const runtime = harnessRuntime(root);
  initProject(runtime, project, capturedIo());
  writeFileSync(join(project, '.agent-docs', 'working.md'), warningMemory('project'));

  const input = capturedIo();
  assert.equal(
    runCli(
      [
        'memory',
        'capture-input',
        project,
        '--title',
        'JSON input',
        '--content',
        'Keep stdout machine-readable.',
        '--source',
        'chat',
        '--mode',
        'verbatim',
        '--purpose',
        'explicit-retain',
        '--retention',
        'durable',
        '--json',
      ],
      { runtime, io: input },
    ),
    0,
  );
  assertSingleJson(input);

  const handoff = capturedIo();
  assert.equal(
    runCli(
      [
        'memory',
        'handoff',
        project,
        '--session',
        'json-contract',
        '--title',
        'JSON handoff',
        '--objective',
        'Keep JSON output valid.',
        '--completed',
        'Added an output contract test.',
        '--next',
        'Run the focused suite.',
        '--reason',
        'phase',
        '--json',
      ],
      { runtime, io: handoff },
    ),
    0,
  );
  assertSingleJson(handoff);

  const checked = capturedIo();
  assert.equal(runCli(['memory', 'check', project, '--json'], { runtime, io: checked }), 0);
  assertSingleJson(checked);

  initGlobal(runtime, capturedIo());
  writeFileSync(join(runtime.memoryHome, 'working.md'), warningMemory('global'));
  const profile = capturedIo();
  assert.equal(
    runCli(
      [
        'memory',
        'reconcile-profile',
        '--key',
        'communication.json-output',
        '--conclusion',
        'Keep JSON stdout machine-readable.',
        '--evidence',
        'explicit',
        '--confidence',
        'high',
        '--json',
      ],
      { runtime, io: profile },
    ),
    0,
  );
  assertSingleJson(profile);
});
