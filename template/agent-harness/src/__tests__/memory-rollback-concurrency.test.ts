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
import { beforeEach, onTestFinished, test, vi } from 'vitest';

const validationFault = vi.hoisted(() => ({
  active: false,
  content: '',
  mode: 0o640,
  path: '',
  skip: 0,
}));

const atomicFault = vi.hoisted(() => ({
  behavior: '' as '' | 'noop' | 'wrong-mode',
  calls: 0,
  path: '',
}));

vi.mock('../lib/memory-validation.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/memory-validation.js')>();
  return {
    ...original,
    validateMemoryRoot: (...args: Parameters<typeof original.validateMemoryRoot>) => {
      if (!validationFault.active) return original.validateMemoryRoot(...args);
      if (validationFault.skip > 0) {
        validationFault.skip -= 1;
        return original.validateMemoryRoot(...args);
      }
      validationFault.active = false;
      writeFileSync(validationFault.path, validationFault.content);
      chmodSync(validationFault.path, validationFault.mode);
      args[1].error(`injected concurrent replacement: ${validationFault.path}`);
      throw new Error('Memory check failed: injected concurrent replacement');
    },
  };
});

vi.mock('../lib/files.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/files.js')>();
  return {
    ...original,
    atomicWrite(path: string, content: string, mode?: number) {
      if (atomicFault.path === path) {
        atomicFault.calls += 1;
        if (atomicFault.calls === 2 && atomicFault.behavior === 'noop') return;
        if (atomicFault.calls === 2 && atomicFault.behavior === 'wrong-mode') {
          original.atomicWrite(path, content, 0o644);
          return;
        }
      }
      original.atomicWrite(path, content, mode);
    },
  };
});

import { initGlobal, initProject } from '../commands/init.js';
import { archiveMemory, supersedeMemory } from '../commands/memory-lifecycle.js';
import { reconcileProfile } from '../commands/memory-profile.js';
import { initTask } from '../commands/task.js';
import { updateAcceptance } from '../commands/task-acceptance.js';
import { writeValidated } from '../lib/memory-write.js';
import { calendarDate } from '../runtime.js';
import { capturedIo, harnessRuntime } from './helpers/harness.js';

beforeEach(() => {
  validationFault.active = false;
  validationFault.content = '';
  validationFault.mode = 0o640;
  validationFault.path = '';
  validationFault.skip = 0;
  atomicFault.behavior = '';
  atomicFault.calls = 0;
  atomicFault.path = '';
});

function fixture(prefix: string): {
  root: string;
  runtime: ReturnType<typeof harnessRuntime>;
} {
  const root = mkdtempSync(join(tmpdir(), prefix));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  return { root, runtime: harnessRuntime(root) };
}

function memoryDocument(title: string, status = 'active'): string {
  return `---
title: ${title}
description: ${title} memory
type: session-handoff
memory-kind: episode
status: ${status}
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

${title} body.
`;
}

function armConcurrentReplacement(
  path: string,
  content: string,
  { mode = 0o640, skip = 0 }: { mode?: number; skip?: number } = {},
): void {
  validationFault.active = true;
  validationFault.path = path;
  validationFault.content = content;
  validationFault.mode = mode;
  validationFault.skip = skip;
}

test('validated write preserves a concurrent replacement instead of rolling it back', () => {
  const { runtime } = fixture('harness-memory-write-concurrent-');
  initGlobal(runtime, capturedIo());
  const profile = join(runtime.memoryHome, 'profile.md');
  const concurrent = 'concurrent writer content\n';
  armConcurrentReplacement(profile, concurrent);

  assert.throws(
    () =>
      writeValidated(
        runtime.memoryHome,
        [{ path: profile, content: 'attempted candidate\n' }],
        capturedIo(),
        { rootKind: 'global' },
      ),
    new RegExp(`rollback was incomplete.*recovery path ${profile}`, 'i'),
  );
  assert.equal(readFileSync(profile, 'utf8'), concurrent);
  assert.equal(statSync(profile).mode & 0o777, 0o640);
});

test('project initialization preserves an unknown validator-time replacement', () => {
  const { root, runtime } = fixture('harness-project-init-concurrent-');
  const project = join(root, 'project');
  mkdirSync(project);
  execFileSync('git', ['-C', project, 'init', '-q']);
  const ignore = join(project, '.gitignore');
  const concurrent = 'concurrent ignore content\n';
  armConcurrentReplacement(ignore, concurrent);

  assert.throws(
    () => initProject(runtime, project, capturedIo()),
    /rollback was incomplete.*recovery path .*\.gitignore/i,
  );
  assert.equal(readFileSync(ignore, 'utf8'), concurrent);
});

test('outer global transaction does not overwrite a replacement retained by inner rollback', () => {
  const { runtime } = fixture('harness-global-double-rollback-');
  initGlobal(runtime, capturedIo());
  const profile = join(runtime.memoryHome, 'profile.md');
  const concurrent = 'concurrent profile content\n';
  armConcurrentReplacement(profile, concurrent, { skip: 1 });

  assert.throws(
    () =>
      reconcileProfile(
        runtime,
        {
          key: 'concurrency.rollback',
          conclusion: 'Preserve a later writer.',
          evidence: 'explicit',
          confidence: 'high',
        },
        capturedIo(),
      ),
    new RegExp(`rollback was incomplete.*recovery path ${profile}`, 'i'),
  );
  assert.equal(readFileSync(profile, 'utf8'), concurrent);
  assert.equal(statSync(profile).mode & 0o777, 0o640);
});

test('task acceptance rollback preserves a validator-time concurrent replacement', () => {
  const { root, runtime } = fixture('harness-task-write-concurrent-');
  const project = join(root, 'project');
  mkdirSync(project);
  execFileSync('git', ['-C', project, 'init', '-q']);
  const task = initTask(
    runtime,
    {
      project,
      id: 'concurrent-task-write',
      objective: 'Preserve a later task writer',
      acceptance: ['Safe'],
    },
    capturedIo(),
  );
  const taskFile = join(project, '.agent-docs', 'working', task.id, 'task.json');
  const concurrent = '{"concurrent":true}\n';
  armConcurrentReplacement(taskFile, concurrent, { skip: 1 });

  assert.throws(
    () =>
      updateAcceptance(
        {
          project,
          id: task.id,
          criterion: 'criterion-1',
          status: 'inconclusive',
        },
        capturedIo(),
      ),
    /rollback was incomplete.*recovery path .*concurrent-task-write\/task\.json/i,
  );
  assert.equal(readFileSync(taskFile, 'utf8'), concurrent);
  assert.equal(statSync(taskFile).mode & 0o777, 0o640);
});

test('supersede preserves a validator-time replacement of its candidate', () => {
  const { runtime } = fixture('harness-supersede-concurrent-');
  initGlobal(runtime, capturedIo());
  const source = join(runtime.memoryHome, 'source.md');
  writeFileSync(source, memoryDocument('Source'));
  writeFileSync(join(runtime.memoryHome, 'replacement.md'), memoryDocument('Replacement'));
  chmodSync(source, 0o600);
  const concurrent = 'concurrent supersede content\n';
  armConcurrentReplacement(source, concurrent, { skip: 1 });

  assert.throws(
    () => supersedeMemory(runtime, 'global', 'source', 'replacement', capturedIo()),
    new RegExp(`rollback was incomplete.*recovery path ${source}`, 'i'),
  );
  assert.equal(readFileSync(source, 'utf8'), concurrent);
  assert.equal(statSync(source).mode & 0o777, 0o640);
});

test('supersede reports an unresolved recovery path when restore is a no-op', () => {
  const { runtime } = fixture('harness-supersede-restore-noop-');
  initGlobal(runtime, capturedIo());
  const source = join(runtime.memoryHome, 'future.md');
  const original = memoryDocument('Future').replaceAll('2026-08-19', '2099-01-01');
  writeFileSync(source, original);
  writeFileSync(join(runtime.memoryHome, 'replacement.md'), memoryDocument('Replacement'));
  chmodSync(source, 0o600);
  atomicFault.path = source;
  atomicFault.behavior = 'noop';

  assert.throws(
    () => supersedeMemory(runtime, 'global', 'future', 'replacement', capturedIo()),
    new RegExp(`rollback was incomplete.*restore was not verified.*recovery path ${source}`, 'i'),
  );
  assert.match(readFileSync(source, 'utf8'), /status: superseded/);
  assert.equal(statSync(source).mode & 0o777, 0o600);
});

test('supersede verifies mode as well as bytes after restoring its snapshot', () => {
  const { runtime } = fixture('harness-supersede-restore-mode-');
  initGlobal(runtime, capturedIo());
  const source = join(runtime.memoryHome, 'future.md');
  const original = memoryDocument('Future').replaceAll('2026-08-19', '2099-01-01');
  writeFileSync(source, original);
  writeFileSync(join(runtime.memoryHome, 'replacement.md'), memoryDocument('Replacement'));
  chmodSync(source, 0o600);
  atomicFault.path = source;
  atomicFault.behavior = 'wrong-mode';

  assert.throws(
    () => supersedeMemory(runtime, 'global', 'future', 'replacement', capturedIo()),
    new RegExp(`rollback was incomplete.*restore was not verified.*recovery path ${source}`, 'i'),
  );
  assert.equal(readFileSync(source, 'utf8'), original);
  assert.equal(statSync(source).mode & 0o777, 0o644);
});

test('archive restores its source but preserves a concurrent destination replacement', () => {
  const { runtime } = fixture('harness-archive-destination-concurrent-');
  initGlobal(runtime, capturedIo());
  const source = join(runtime.memoryHome, 'archive-source.md');
  const original = memoryDocument('Archive source', 'complete');
  writeFileSync(source, original);
  chmodSync(source, 0o600);
  const date = calendarDate(runtime);
  const destination = join(
    runtime.memoryHome,
    '_archive',
    date.slice(0, 4),
    date.slice(5, 7),
    'archive-source.md',
  );
  const concurrent = 'concurrent archive destination\n';
  armConcurrentReplacement(destination, concurrent, { skip: 1 });

  assert.throws(
    () => archiveMemory(runtime, 'global', 'archive-source', {}, capturedIo()),
    new RegExp(`rollback was incomplete.*recovery path ${destination}`, 'i'),
  );
  assert.equal(readFileSync(source, 'utf8'), original);
  assert.equal(statSync(source).mode & 0o777, 0o600);
  assert.equal(readFileSync(destination, 'utf8'), concurrent);
  assert.equal(statSync(destination).mode & 0o777, 0o640);
});
