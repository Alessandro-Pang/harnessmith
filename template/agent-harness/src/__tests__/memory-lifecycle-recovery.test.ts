import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, onTestFinished, test, vi } from 'vitest';

const fault = vi.hoisted(() => ({ restorePath: '' }));

vi.mock('../lib/files.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/files.js')>();
  return {
    ...actual,
    atomicWrite(path: string, content: string, mode?: number) {
      if (fault.restorePath === path && !existsSync(path)) {
        throw new Error(`injected source restore failure: ${path}`);
      }
      actual.atomicWrite(path, content, mode);
    },
  };
});

import { initGlobal } from '../commands/init.js';
import { archiveMemory } from '../commands/memory-lifecycle.js';
import { calendarDate } from '../runtime.js';
import { assertMode, capturedIo, escapeRegExp, harnessRuntime } from './helpers/harness.js';

beforeEach(() => {
  fault.restorePath = '';
});

function memoryDocument(): string {
  return `---
title: Recovery source
description: Recovery source memory
type: session-handoff
memory-kind: episode
status: complete
owners: [test-owner]
created: 2099-01-01
updated: 2099-01-01
project: test
tags: [test]
scope: []
source-refs: []
source-of-truth: false
schema-version: 1
---

Recover me.
`;
}

test('archive retains its destination recovery copy when source restoration fails', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-memory-archive-recovery-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const runtime = harnessRuntime(root);
  initGlobal(runtime, capturedIo());
  const source = join(runtime.memoryHome, 'recovery.md');
  writeFileSync(source, memoryDocument());
  chmodSync(source, 0o600);
  fault.restorePath = source;
  const date = calendarDate(runtime);
  const destination = join(
    runtime.memoryHome,
    '_archive',
    date.slice(0, 4),
    date.slice(5, 7),
    'recovery.md',
  );

  assert.throws(
    () => archiveMemory(runtime, 'global', 'recovery', {}, capturedIo()),
    new RegExp(
      `rollback was incomplete.*recovery path ${escapeRegExp(destination)} is retained`,
      'i',
    ),
  );
  assert.equal(existsSync(source), false);
  assert.equal(existsSync(destination), true);
  assert.match(readFileSync(destination, 'utf8'), /status: archived/);
  assert.match(readFileSync(destination, 'utf8'), /Recover me\./);
  assertMode(destination, 0o600);
});
