import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { initGlobal, initProject } from '../commands/init.js';
import { memoryCheck } from '../commands/memory.js';
import { captureHandoff, closeHandoff } from '../commands/memory-autopilot.js';
import { archiveMemory, memoryMaintenance, supersedeMemory } from '../commands/memory-lifecycle.js';
import { closeTask, initTask, taskStatus } from '../commands/task.js';
import { verifyAcceptance } from '../commands/task-verification.js';
import { calendarDate } from '../runtime.js';
import { assertMode, capturedIo, harnessRuntime } from './helpers/harness.js';

function fixture(): { root: string; runtime: ReturnType<typeof harnessRuntime> } {
  const root = mkdtempSync(join(tmpdir(), 'harness-memory-lifecycle-safety-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  return { root, runtime: harnessRuntime(root) };
}

function memoryDocument(title: string): string {
  return [
    '---',
    `title: ${title}`,
    `description: ${title} memory`,
    'type: session-handoff',
    'memory-kind: episode',
    'status: active',
    'owners: [test-owner]',
    'created: 2026-08-19',
    'updated: 2026-08-19',
    'project: test',
    'tags: [test]',
    'scope: []',
    'source-refs: []',
    'source-of-truth: false',
    'schema-version: 1',
    '---',
    '',
    '',
  ].join('\n');
}

test('memory lifecycle commands reject reserved root entries even when archive is forced', () => {
  const { root, runtime } = fixture();
  const project = join(root, 'project');
  mkdirSync(project, { recursive: true });
  execFileSync('git', ['-C', project, 'init', '-q']);
  initProject(runtime, project, capturedIo());
  initGlobal(runtime, capturedIo());
  const projectMemory = join(project, '.agent-docs');
  writeFileSync(join(projectMemory, 'replacement.md'), memoryDocument('Replacement'));

  for (const name of ['README', 'core']) {
    assert.throws(
      () => archiveMemory(runtime, project, name, { force: true }, capturedIo()),
      /reserved memory root entry/i,
    );
    assert.equal(existsSync(join(projectMemory, `${name}.md`)), true);
  }
  assert.throws(
    () => supersedeMemory(runtime, project, 'core', 'replacement', capturedIo()),
    /reserved memory root entry/i,
  );
  assert.doesNotMatch(readFileSync(join(projectMemory, 'core.md'), 'utf8'), /status: superseded/);
  assert.throws(
    () => archiveMemory(runtime, 'global', 'profile', { force: true }, capturedIo()),
    /reserved memory root entry/i,
  );
  assert.equal(existsSync(join(runtime.memoryHome, 'profile.md')), true);
});

test('memory lifecycle commands reject portable aliases of reserved root entries', () => {
  const { root, runtime } = fixture();
  const project = join(root, 'project');
  mkdirSync(project, { recursive: true });
  execFileSync('git', ['-C', project, 'init', '-q']);
  initProject(runtime, project, capturedIo());
  const memoryRoot = join(project, '.agent-docs');
  const canonical = join(memoryRoot, 'core.md');
  const temporary = join(memoryRoot, 'renaming-core.md');
  const alias = join(memoryRoot, 'CORE.md');
  const before = readFileSync(canonical, 'utf8');
  renameSync(canonical, temporary);
  renameSync(temporary, alias);
  writeFileSync(join(memoryRoot, 'replacement.md'), memoryDocument('Replacement'));

  assert.throws(
    () => archiveMemory(runtime, project, 'CORE', { force: true }, capturedIo()),
    /reserved memory root entry/i,
  );
  assert.throws(
    () => supersedeMemory(runtime, project, 'CORE', 'replacement', capturedIo()),
    /reserved memory root entry/i,
  );
  assert.equal(readFileSync(alias, 'utf8'), before);
});

test('memory archive preserves a private source mode at its destination', () => {
  const { runtime } = fixture();
  initGlobal(runtime, capturedIo());
  const source = join(runtime.memoryHome, 'private.md');
  writeFileSync(source, memoryDocument('Private').replace('status: active', 'status: complete'));
  chmodSync(source, 0o600);

  const archived = archiveMemory(runtime, 'global', 'private', {}, capturedIo());

  assert.equal(existsSync(source), false);
  assertMode(archived, 0o600);
});

test('memory archive rejects recursive re-archiving even with force', () => {
  const { runtime } = fixture();
  initGlobal(runtime, capturedIo());
  const source = join(runtime.memoryHome, 'once.md');
  writeFileSync(source, memoryDocument('Once').replace('status: active', 'status: complete'));
  const archived = archiveMemory(runtime, 'global', 'once', {}, capturedIo());
  const archivedReference = relative(runtime.memoryHome, archived)
    .replaceAll('\\', '/')
    .replace(/\.md$/, '');
  const date = calendarDate(runtime);
  const recursiveDestination = join(
    runtime.memoryHome,
    '_archive',
    date.slice(0, 4),
    date.slice(5, 7),
    relative(runtime.memoryHome, archived),
  );

  assert.throws(
    () => archiveMemory(runtime, 'global', archivedReference, { force: true }, capturedIo()),
    /already archived/i,
  );
  assert.equal(existsSync(archived), true);
  assert.equal(existsSync(recursiveDestination), false);
});

test('memory archive rejects portable destination collisions before moving the source', () => {
  const { runtime } = fixture();
  initGlobal(runtime, capturedIo());
  const source = join(runtime.memoryHome, 'case.md');
  const date = calendarDate(runtime);
  const existing = join(
    runtime.memoryHome,
    '_archive',
    date.slice(0, 4),
    date.slice(5, 7),
    'CASE.md',
  );
  writeFileSync(source, memoryDocument('Case').replace('status: active', 'status: complete'));
  mkdirSync(dirname(existing), { recursive: true });
  writeFileSync(
    existing,
    memoryDocument('Existing archive').replace('status: active', 'status: archived'),
  );
  const before = readFileSync(existing, 'utf8');

  assert.throws(
    () => archiveMemory(runtime, 'global', 'case', {}, capturedIo()),
    /portable archive destination collision/i,
  );
  assert.equal(existsSync(source), true);
  assert.equal(readFileSync(existing, 'utf8'), before);
  assert.equal(readdirSync(dirname(existing)).includes('case.md'), false);
});

test('closed typed handoffs retain strict identity after canonical archive', () => {
  const { root, runtime } = fixture();
  const project = join(root, 'project');
  mkdirSync(project);
  execFileSync('git', ['-C', project, 'init', '-q']);
  const created = captureHandoff(
    runtime,
    project,
    {
      session: 'archived-handoff',
      title: 'Archived handoff',
      objective: 'Keep historical recovery structure queryable.',
      completed: 'Validated the work.',
      next: 'Close and archive the snapshot.',
      reason: 'phase',
    },
    capturedIo(),
  );
  closeHandoff(
    runtime,
    project,
    { session: 'archived-handoff', outcome: 'cancelled' },
    capturedIo(),
  );

  const archived = archiveMemory(runtime, project, created.reference, {}, capturedIo());

  assert.match(
    archived.replaceAll('\\', '/'),
    /\/\.agent-docs\/_archive\/\d{4}\/\d{2}\/sessions\/\d{4}\/\d{2}\/\d{2}\/archived-handoff\.md$/,
  );
  assert.match(readFileSync(archived, 'utf8'), /snapshot-mode: replace/);
  assert.match(readFileSync(archived, 'utf8'), /status: archived/);
  assert.doesNotThrow(() => memoryCheck(runtime, project, capturedIo()));
  assert.equal(
    memoryMaintenance(runtime, project, {}, capturedIo()).closed.includes(archived),
    false,
  );

  const forged = join(dirname(archived), 'forged-name.md');
  renameSync(archived, forged);
  const validation = capturedIo();
  assert.throws(() => memoryCheck(runtime, project, validation), /issue/i);
  assert.match(validation.errors.join('\n'), /typed handoff canonical path/i);
});

test('completed task progress remains a strict task ledger after canonical archive', () => {
  const { root, runtime } = fixture();
  const project = join(root, 'project');
  mkdirSync(project);
  execFileSync('git', ['-C', project, 'init', '-q']);
  writeFileSync(join(project, 'verification.txt'), 'verification scope\n');
  const task = initTask(
    runtime,
    {
      project,
      id: 'archived-task',
      objective: 'Archive completed task progress safely',
      acceptance: ['The task archive is validated'],
    },
    capturedIo(),
  );
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
  closeTask({ project, id: task.id, summary: 'Task archive is validated' }, capturedIo());
  assert.equal(
    memoryMaintenance(runtime, project, {}, capturedIo()).closed.includes(
      `working/${task.id}/progress.md`,
    ),
    true,
  );

  const archived = archiveMemory(runtime, project, `working/${task.id}/progress`, {}, capturedIo());

  assert.match(
    archived.replaceAll('\\', '/'),
    /\/\.agent-docs\/_archive\/\d{4}\/\d{2}\/working\/archived-task\/progress\.md$/,
  );
  assert.doesNotThrow(() => memoryCheck(runtime, project, capturedIo()));
  const persisted = taskStatus({ project, id: task.id }, capturedIo());
  assert.equal(Array.isArray(persisted) ? undefined : persisted.status, 'complete');

  const forged = join(dirname(archived), 'other.md');
  renameSync(archived, forged);
  const validation = capturedIo();
  assert.throws(() => memoryCheck(runtime, project, validation), /issue/i);
  assert.match(validation.errors.join('\n'), /task-ledger memory.*canonical/i);
});

test('memory archive rejects non-canonical archive directory aliases before mutation', () => {
  const { runtime } = fixture();
  initGlobal(runtime, capturedIo());
  const source = join(runtime.memoryHome, 'foo.md');
  const date = calendarDate(runtime);
  const alias = join(runtime.memoryHome, '_ARCHIVE', date.slice(0, 4), date.slice(5, 7), 'foo.md');
  writeFileSync(source, memoryDocument('Foo').replace('status: active', 'status: complete'));
  mkdirSync(alias, { recursive: true });
  writeFileSync(join(alias, 'inside.md'), memoryDocument('Inside'));

  const io = capturedIo();
  assert.throws(() => archiveMemory(runtime, 'global', 'foo', {}, io), /memory check failed/i);
  assert.match(io.errors.join('\n'), /top-level canonical _archive/i);
  assert.equal(existsSync(source), true);
  assert.equal(existsSync(join(alias, 'inside.md')), true);
  assert.equal(readdirSync(runtime.memoryHome).includes('_archive'), false);
});

test('memory archive rejects an existing directory at the planned destination file path', () => {
  const { runtime } = fixture();
  initGlobal(runtime, capturedIo());
  const source = join(runtime.memoryHome, 'foo.md');
  const date = calendarDate(runtime);
  const destination = join(
    runtime.memoryHome,
    '_archive',
    date.slice(0, 4),
    date.slice(5, 7),
    'foo.md',
  );
  writeFileSync(source, memoryDocument('Foo').replace('status: active', 'status: complete'));
  mkdirSync(destination, { recursive: true });
  writeFileSync(
    join(destination, 'inside.md'),
    memoryDocument('Inside').replace('status: active', 'status: archived'),
  );

  assert.throws(
    () => archiveMemory(runtime, 'global', 'foo', {}, capturedIo()),
    /portable archive destination collision/i,
  );
  assert.equal(existsSync(source), true);
  assert.equal(existsSync(join(destination, 'inside.md')), true);
});

test('memory archive rolls back a move when post-move root validation fails', () => {
  const { runtime } = fixture();
  initGlobal(runtime, capturedIo());
  const source = join(runtime.memoryHome, 'future.md');
  const future = memoryDocument('Future')
    .replace('status: active', 'status: complete')
    .replaceAll('2026-08-19', '2099-01-01');
  writeFileSync(source, future);
  chmodSync(source, 0o600);
  const date = calendarDate(runtime);
  const archiveYear = join(runtime.memoryHome, '_archive', date.slice(0, 4));
  const sentinel = join(archiveYear, 'keep.txt');
  mkdirSync(archiveYear, { recursive: true });
  writeFileSync(sentinel, 'unrelated archive data\n');
  const destination = join(archiveYear, date.slice(5, 7), 'future.md');
  const io = capturedIo();

  assert.throws(() => archiveMemory(runtime, 'global', 'future', {}, io), /memory check failed/i);
  assert.equal(readFileSync(source, 'utf8'), future);
  assertMode(source, 0o600);
  assert.equal(existsSync(destination), false);
  assert.equal(existsSync(dirname(destination)), false);
  assert.equal(readFileSync(sentinel, 'utf8'), 'unrelated archive data\n');
  assert.equal(io.logs.length, 0);
});

test('memory supersede preserves a private source mode', () => {
  const { runtime } = fixture();
  initGlobal(runtime, capturedIo());
  const source = join(runtime.memoryHome, 'source.md');
  writeFileSync(source, memoryDocument('Source'));
  writeFileSync(join(runtime.memoryHome, 'replacement.md'), memoryDocument('Replacement'));
  chmodSync(source, 0o600);

  supersedeMemory(runtime, 'global', 'source', 'replacement', capturedIo());

  assert.match(readFileSync(source, 'utf8'), /status: superseded/);
  assertMode(source, 0o600);
});

test('memory supersede restores original bytes and mode when post-write validation fails', () => {
  const { runtime } = fixture();
  initGlobal(runtime, capturedIo());
  const source = join(runtime.memoryHome, 'future.md');
  const original = memoryDocument('Future').replaceAll('2026-08-19', '2099-01-01');
  writeFileSync(source, original);
  writeFileSync(join(runtime.memoryHome, 'replacement.md'), memoryDocument('Replacement'));
  chmodSync(source, 0o600);
  const io = capturedIo();

  assert.throws(
    () => supersedeMemory(runtime, 'global', 'future', 'replacement', io),
    /memory check failed/i,
  );
  assert.equal(readFileSync(source, 'utf8'), original);
  assertMode(source, 0o600);
  assert.equal(io.logs.length, 0);
});
