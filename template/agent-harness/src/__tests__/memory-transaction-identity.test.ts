import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
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

const directoryFault = vi.hoisted(() => ({ path: '', skip: 0 }));
const atomicReplacement = vi.hoisted(() => ({
  afterWritePath: '',
  content: '',
  mode: 0o640,
  path: '',
}));
const boundedReplacement = vi.hoisted(() => ({
  content: '',
  mode: 0o640,
  path: '',
  skip: 0,
}));
const templateReplacement = vi.hoisted(() => ({
  mode: 0o640,
  path: '',
  skip: 0,
}));

vi.mock('../lib/memory-validation.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/memory-validation.js')>();
  return {
    ...original,
    validateMemoryRoot: (...args: Parameters<typeof original.validateMemoryRoot>) => {
      if (!directoryFault.path) return original.validateMemoryRoot(...args);
      if (directoryFault.skip > 0) {
        directoryFault.skip -= 1;
        return original.validateMemoryRoot(...args);
      }
      const path = directoryFault.path;
      directoryFault.path = '';
      rmSync(path, { recursive: true, force: true });
      mkdirSync(path, { recursive: true });
      args[1].error(`injected concurrent directory replacement: ${path}`);
      throw new Error('Memory check failed: injected concurrent directory replacement');
    },
  };
});

vi.mock('../lib/files.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/files.js')>();
  return {
    ...original,
    atomicWrite(path: string, content: string, mode?: number) {
      original.atomicWrite(path, content, mode);
      if (atomicReplacement.afterWritePath === path && atomicReplacement.path) {
        atomicReplacement.afterWritePath = '';
        writeFileSync(atomicReplacement.path, atomicReplacement.content);
        chmodSync(atomicReplacement.path, atomicReplacement.mode);
      }
    },
  };
});

vi.mock('../lib/bounded-file.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/bounded-file.js')>();
  return {
    ...original,
    readBoundedRegularFile: (...args: Parameters<typeof original.readBoundedRegularFile>) => {
      const result = original.readBoundedRegularFile(...args);
      if (boundedReplacement.path === args[0]) {
        if (boundedReplacement.skip > 0) boundedReplacement.skip -= 1;
        else {
          const path = boundedReplacement.path;
          boundedReplacement.path = '';
          writeFileSync(path, boundedReplacement.content);
          chmodSync(path, boundedReplacement.mode);
        }
      }
      return result;
    },
  };
});

vi.mock('../lib/templates.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/templates.js')>();
  return {
    ...original,
    render: (...args: Parameters<typeof original.render>) => {
      const content = original.render(...args);
      if (templateReplacement.path) {
        if (templateReplacement.skip > 0) templateReplacement.skip -= 1;
        else {
          const path = templateReplacement.path;
          templateReplacement.path = '';
          writeFileSync(path, `${content}\nExternal writer marker.\n`);
          chmodSync(path, templateReplacement.mode);
        }
      }
      return content;
    },
  };
});

import { initGlobal } from '../commands/init.js';
import { archiveMemory } from '../commands/memory-lifecycle.js';
import {
  archiveMemoryAndValidate,
  replaceMemoryAndValidate,
  snapshotMemoryFile,
} from '../lib/memory-lifecycle-transaction.js';
import { writeValidated } from '../lib/memory-write.js';
import { withProjectMemoryTransaction } from '../lib/project-memory.js';
import { calendarDate } from '../runtime.js';
import { capturedIo, harnessRuntime } from './helpers/harness.js';

beforeEach(() => {
  directoryFault.path = '';
  directoryFault.skip = 0;
  atomicReplacement.afterWritePath = '';
  atomicReplacement.content = '';
  atomicReplacement.mode = 0o640;
  atomicReplacement.path = '';
  boundedReplacement.content = '';
  boundedReplacement.mode = 0o640;
  boundedReplacement.path = '';
  boundedReplacement.skip = 0;
  templateReplacement.mode = 0o640;
  templateReplacement.path = '';
  templateReplacement.skip = 0;
});

function fixture(prefix: string) {
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

test('validated write refuses a target replaced after its snapshot', () => {
  const { runtime } = fixture('harness-memory-write-prewrite-conflict-');
  initGlobal(runtime, capturedIo());
  const profile = join(runtime.memoryHome, 'profile.md');
  const original = readFileSync(profile, 'utf8');
  const concurrent = 'concurrent prewrite content\n';
  let replaced = false;
  const entry = {
    path: profile,
    get content(): string {
      if (!replaced) {
        replaced = true;
        writeFileSync(profile, concurrent);
        chmodSync(profile, 0o640);
      }
      return original;
    },
  };

  assert.throws(
    () => writeValidated(runtime.memoryHome, [entry], capturedIo(), { rootKind: 'global' }),
    new RegExp(`Memory write conflict.*recovery path ${profile}`, 'i'),
  );
  assert.equal(readFileSync(profile, 'utf8'), concurrent);
  assert.equal(statSync(profile).mode & 0o777, 0o640);
});

test('validated write preserves an empty directory replaced before rollback cleanup', () => {
  const { runtime } = fixture('harness-memory-write-directory-replacement-');
  initGlobal(runtime, capturedIo());
  const directory = join(runtime.memoryHome, 'sessions', '2000', '01');
  directoryFault.path = directory;

  assert.throws(
    () =>
      writeValidated(
        runtime.memoryHome,
        [{ path: join(directory, 'invalid.md'), content: 'invalid\n' }],
        capturedIo(),
      ),
    new RegExp(`rollback was incomplete.*recovery path ${directory}`, 'i'),
  );
  assert.equal(existsSync(directory), true);
});

test('project transaction preserves an empty memory root replacement during rollback', () => {
  const { root, runtime } = fixture('harness-project-transaction-root-replacement-');
  const project = join(root, 'project');
  const memoryRoot = join(project, '.agent-docs');
  mkdirSync(project);

  assert.throws(
    () =>
      withProjectMemoryTransaction(runtime, project, () => {
        rmSync(memoryRoot, { recursive: true, force: true });
        mkdirSync(memoryRoot);
        throw new Error('force rollback after root replacement');
      }),
    /rollback was incomplete.*recovery path .*\.agent-docs/i,
  );
  assert.equal(existsSync(memoryRoot), true);
});

test('project ignore update refuses an external replacement made after its bounded read', () => {
  const { root, runtime } = fixture('harness-project-ignore-prewrite-conflict-');
  const project = join(root, 'project');
  const memoryRoot = join(project, '.agent-docs');
  const ignore = join(memoryRoot, '.gitignore');
  const concurrent = '# external writer\n*.external\n';
  mkdirSync(memoryRoot, { recursive: true });
  writeFileSync(ignore, '# original\n');
  boundedReplacement.path = ignore;
  boundedReplacement.content = concurrent;
  boundedReplacement.skip = 1;

  assert.throws(
    () => withProjectMemoryTransaction(runtime, project, (initialization) => initialization),
    new RegExp(`Project ignore update conflict.*recovery path ${ignore}`, 'i'),
  );
  assert.equal(readFileSync(ignore, 'utf8'), concurrent);
  assert.equal(statSync(ignore).mode & 0o777, 0o640);
});

test.each(['README.md', 'core.md'])(
  'project initialization refuses an externally created %s after its missing snapshot',
  (name) => {
    const { root, runtime } = fixture(`harness-project-${name.toLowerCase()}-prewrite-conflict-`);
    const project = join(root, 'project');
    const destination = join(project, '.agent-docs', name);
    mkdirSync(project);
    templateReplacement.path = destination;
    templateReplacement.skip = name === 'core.md' ? 1 : 0;

    assert.throws(
      () => withProjectMemoryTransaction(runtime, project, (initialization) => initialization),
      new RegExp(`Project memory initialization conflict.*recovery path ${destination}`, 'i'),
    );
    assert.match(readFileSync(destination, 'utf8'), /External writer marker/);
    assert.equal(statSync(destination).mode & 0o777, 0o640);
  },
);

test('supersede refuses a source replaced after its snapshot', () => {
  const { runtime } = fixture('harness-supersede-prewrite-conflict-');
  initGlobal(runtime, capturedIo());
  const source = join(runtime.memoryHome, 'source.md');
  writeFileSync(source, memoryDocument('Source'));
  chmodSync(source, 0o600);
  const snapshot = snapshotMemoryFile(source);
  const concurrent = 'concurrent supersede prewrite content\n';
  writeFileSync(source, concurrent);
  chmodSync(source, 0o640);

  assert.throws(
    () =>
      replaceMemoryAndValidate(
        runtime.memoryHome,
        snapshot,
        snapshot.content,
        'global',
        capturedIo(),
      ),
    new RegExp(`Memory supersede conflict.*recovery path ${source}`, 'i'),
  );
  assert.equal(readFileSync(source, 'utf8'), concurrent);
  assert.equal(statSync(source).mode & 0o777, 0o640);
});

test('archive refuses a destination created after its missing snapshot', () => {
  const { runtime } = fixture('harness-archive-destination-prewrite-conflict-');
  initGlobal(runtime, capturedIo());
  const source = join(runtime.memoryHome, 'archive-source.md');
  const original = memoryDocument('Archive source', 'complete');
  writeFileSync(source, original);
  chmodSync(source, 0o600);
  const snapshot = snapshotMemoryFile(source);
  const date = calendarDate(runtime);
  const archiveDirectory = join(runtime.memoryHome, '_archive', date.slice(0, 4), date.slice(5, 7));
  const destination = join(archiveDirectory, 'archive-source.md');
  mkdirSync(archiveDirectory, { recursive: true });
  const concurrent = 'concurrent archive destination content\n';
  writeFileSync(destination, concurrent);
  chmodSync(destination, 0o640);

  assert.throws(
    () =>
      archiveMemoryAndValidate(
        runtime.memoryHome,
        snapshot,
        destination,
        snapshot.content.replace(/^status: complete$/m, 'status: archived'),
        'global',
        capturedIo(),
      ),
    new RegExp(`Memory archive destination conflict.*recovery path ${destination}`, 'i'),
  );
  assert.equal(readFileSync(source, 'utf8'), original);
  assert.equal(readFileSync(destination, 'utf8'), concurrent);
  assert.equal(statSync(destination).mode & 0o777, 0o640);
});

test('archive refuses to remove a source replaced after writing its candidate', () => {
  const { runtime } = fixture('harness-archive-source-predelete-conflict-');
  initGlobal(runtime, capturedIo());
  const source = join(runtime.memoryHome, 'archive-source.md');
  writeFileSync(source, memoryDocument('Archive source', 'complete'));
  chmodSync(source, 0o600);
  const snapshot = snapshotMemoryFile(source);
  const date = calendarDate(runtime);
  const destination = join(
    runtime.memoryHome,
    '_archive',
    date.slice(0, 4),
    date.slice(5, 7),
    'archive-source.md',
  );
  const concurrent = 'concurrent archive source content\n';
  atomicReplacement.afterWritePath = destination;
  atomicReplacement.path = source;
  atomicReplacement.content = concurrent;

  assert.throws(
    () =>
      archiveMemoryAndValidate(
        runtime.memoryHome,
        snapshot,
        destination,
        snapshot.content.replace(/^status: complete$/m, 'status: archived'),
        'global',
        capturedIo(),
      ),
    new RegExp(`Memory archive source conflict.*recovery path ${source}`, 'i'),
  );
  assert.equal(readFileSync(source, 'utf8'), concurrent);
  assert.equal(statSync(source).mode & 0o777, 0o640);
  assert.equal(existsSync(destination), true);
});

test('archive preserves an empty directory replaced before rollback cleanup', () => {
  const { runtime } = fixture('harness-archive-directory-replacement-');
  initGlobal(runtime, capturedIo());
  const source = join(runtime.memoryHome, 'archive-source.md');
  const original = memoryDocument('Archive source', 'complete');
  writeFileSync(source, original);
  chmodSync(source, 0o600);
  const date = calendarDate(runtime);
  const archiveMonth = join(runtime.memoryHome, '_archive', date.slice(0, 4), date.slice(5, 7));
  directoryFault.path = archiveMonth;
  directoryFault.skip = 1;

  assert.throws(
    () => archiveMemory(runtime, 'global', 'archive-source', {}, capturedIo()),
    new RegExp(`rollback was incomplete.*recovery path ${archiveMonth}`, 'i'),
  );
  assert.equal(readFileSync(source, 'utf8'), original);
  assert.equal(statSync(source).mode & 0o777, 0o600);
  assert.equal(existsSync(archiveMonth), true);
});
