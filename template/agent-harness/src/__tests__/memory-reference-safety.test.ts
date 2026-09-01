import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { initGlobal, initProject } from '../commands/init.js';
import { memoryCheck, memoryList, memorySearch } from '../commands/memory.js';
import { captureInput } from '../commands/memory-input.js';
import { archiveMemory } from '../commands/memory-lifecycle.js';
import { memoryMaintenance } from '../commands/memory-maintenance.js';
import { maximumMemoryDocumentBytes } from '../lib/memory-path.js';
import { capturedIo, harnessRuntime } from './helpers/harness.js';

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'harness-memory-reference-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

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

test('global profile routing is section-aware and does not duplicate an existing header', () => {
  const root = fixture();
  const runtime = harnessRuntime(root);
  initGlobal(runtime, capturedIo());
  const core = join(runtime.memoryHome, 'core.md');
  const validCore = readFileSync(core, 'utf8');
  const malformed = `${validCore}\n## Other Routes\n\n- misplaced memory:profile must not satisfy User Profile\n`;
  writeFileSync(core, malformed);
  assert.throws(() => initGlobal(runtime, capturedIo()), /duplicate pointer/i);
  assert.equal(readFileSync(core, 'utf8'), malformed);

  writeFileSync(
    core,
    `${validCore.replace(
      '- 每个新宿主 task/thread 首次工作前读取一次 `memory:profile`；同一 task/thread 不重复读取。',
      '',
    )}\n## Other Routes\n\nMisplaced profile prose must not satisfy User Profile.\n`,
  );

  initGlobal(runtime, capturedIo());

  const repaired = readFileSync(core, 'utf8');
  const profileSection = repaired.slice(
    repaired.indexOf('## User Profile'),
    repaired.indexOf('## Other Routes'),
  );
  assert.equal(repaired.match(/^## User Profile$/gm)?.length, 1);
  assert.match(profileSection, /memory:profile/);
  assert.match(repaired, /Misplaced profile prose/);
});

test('global core validation rejects duplicate User Profile sections', () => {
  const root = fixture();
  const runtime = harnessRuntime(root);
  initGlobal(runtime, capturedIo());
  const core = join(runtime.memoryHome, 'core.md');
  writeFileSync(
    core,
    `${readFileSync(core, 'utf8')}\n## User Profile\n\n- duplicate route to memory:profile\n`,
  );

  const validation = capturedIo();
  assert.throws(() => memoryCheck(runtime, 'global', validation), /issue/i);
  assert.match(validation.errors.join('\n'), /section must appear exactly once.*User Profile/i);
  assert.throws(() => initGlobal(runtime, capturedIo()), /section must appear exactly once/i);
});

test('a project named global still uses the project core layout', () => {
  const root = fixture();
  const project = join(root, 'global');
  mkdirSync(project, { recursive: true });
  execFileSync('git', ['-C', project, 'init', '-q']);
  const runtime = harnessRuntime(root);
  initProject(runtime, project, capturedIo());

  assert.doesNotThrow(() => memoryCheck(runtime, project, capturedIo(), { indexed: true }));
  const result = captureInput(
    runtime,
    project,
    { title: 'Global-named project', content: 'Keep project scope.', source: 'chat' },
    capturedIo(),
  );
  assert.equal(result.action, 'created');
  assert.doesNotThrow(() => memoryCheck(runtime, project, capturedIo(), { indexed: true }));
});

test('core validation rejects partial project and global hybrid layouts', () => {
  const root = fixture();
  const project = join(root, 'project');
  mkdirSync(project, { recursive: true });
  execFileSync('git', ['-C', project, 'init', '-q']);
  const runtime = harnessRuntime(root);
  initProject(runtime, project, capturedIo());
  initGlobal(runtime, capturedIo());
  const projectCore = join(project, '.agent-docs', 'core.md');
  const globalCore = join(runtime.memoryHome, 'core.md');
  writeFileSync(
    projectCore,
    readFileSync(projectCore, 'utf8')
      .replace('## Important Inputs', '## User Profile')
      .replace('## Recent Handoffs', '## Former Handoffs'),
  );
  writeFileSync(
    globalCore,
    `${readFileSync(globalCore, 'utf8').replace(
      '## User Profile',
      '## Important Inputs',
    )}\n## Recent Handoffs\n\n- exact project shape\n`,
  );

  for (const input of [project, 'global']) {
    const validation = capturedIo();
    assert.throws(() => memoryCheck(runtime, input, validation), /issue/i);
    assert.match(validation.errors.join('\n'), /managed section layout/i);
  }
});

test('project memory rejects a copied global user profile', () => {
  const root = fixture();
  const project = join(root, 'project');
  mkdirSync(project, { recursive: true });
  execFileSync('git', ['-C', project, 'init', '-q']);
  const runtime = harnessRuntime(root);
  initProject(runtime, project, capturedIo());
  initGlobal(runtime, capturedIo());
  const projectMemory = join(project, '.agent-docs');
  const projectCore = join(projectMemory, 'core.md');
  writeFileSync(
    join(projectMemory, 'profile.md'),
    readFileSync(join(runtime.memoryHome, 'profile.md'), 'utf8'),
  );
  writeFileSync(
    projectCore,
    `${readFileSync(projectCore, 'utf8')}\n- copied global profile memory:profile\n`,
  );

  const validation = capturedIo();
  assert.throws(
    () => memoryCheck(runtime, project, validation, { indexed: true }),
    /memory check failed/i,
  );
  assert.match(validation.errors.join('\n'), /user profile is permitted only in global memory/i);
});

test('memory reference validation rejects direct and parent-directory symlinks', () => {
  const root = fixture();
  const project = join(root, 'project');
  const outside = join(root, 'outside');
  mkdirSync(project, { recursive: true });
  mkdirSync(outside, { recursive: true });
  execFileSync('git', ['-C', project, 'init', '-q']);
  const runtime = harnessRuntime(root);
  initProject(runtime, project, capturedIo());
  const memoryRoot = join(project, '.agent-docs');
  const core = join(memoryRoot, 'core.md');
  const outsideNote = join(outside, 'note.md');
  writeFileSync(outsideNote, memoryDocument('Outside note'));
  symlinkSync(outsideNote, join(memoryRoot, 'link.md'), 'file');
  writeFileSync(core, `${readFileSync(core, 'utf8')}\n- unsafe memory:link\n`);

  const direct = capturedIo();
  assert.throws(() => memoryCheck(runtime, project, direct), /issue/i);
  assert.match(direct.errors.join('\n'), /invalid memory reference.*symbolic link/i);

  rmSync(join(memoryRoot, 'link.md'));
  symlinkSync(outside, join(memoryRoot, 'linked'), 'dir');
  writeFileSync(core, readFileSync(core, 'utf8').replace('memory:link', 'memory:linked/note'));
  const parent = capturedIo();
  assert.throws(() => memoryCheck(runtime, project, parent), /issue/i);
  assert.match(parent.errors.join('\n'), /invalid memory reference.*symbolic link/i);
});

test('extensionless memory references resolve only to markdown documents', () => {
  const root = fixture();
  const project = join(root, 'project');
  mkdirSync(project, { recursive: true });
  execFileSync('git', ['-C', project, 'init', '-q']);
  const runtime = harnessRuntime(root);
  initProject(runtime, project, capturedIo());
  const memoryRoot = join(project, '.agent-docs');
  mkdirSync(join(memoryRoot, 'inputs'));
  const core = join(memoryRoot, 'core.md');
  writeFileSync(core, `${readFileSync(core, 'utf8')}\n- directory is not a doc memory:inputs\n`);

  const validation = capturedIo();
  assert.throws(() => memoryCheck(runtime, project, validation), /issue/i);
  assert.match(validation.errors.join('\n'), /broken memory reference: memory:inputs/i);
});

test('memory references reject non-canonical dot-segment aliases', () => {
  const root = fixture();
  const runtime = harnessRuntime(root);
  initGlobal(runtime, capturedIo());
  const core = join(runtime.memoryHome, 'core.md');
  writeFileSync(core, `${readFileSync(core, 'utf8')}\n- alias memory:./profile\n`);

  const validation = capturedIo();
  assert.throws(() => memoryCheck(runtime, 'global', validation), /issue/i);
  assert.match(validation.errors.join('\n'), /not canonical/i);
});

test('host-evaluation artifacts cannot become memory references or lifecycle targets', () => {
  const root = fixture();
  const project = join(root, 'project');
  mkdirSync(project, { recursive: true });
  execFileSync('git', ['-C', project, 'init', '-q']);
  const runtime = harnessRuntime(root);
  initProject(runtime, project, capturedIo());
  const memoryRoot = join(project, '.agent-docs');
  const artifact = join(memoryRoot, 'HOST-EVALS', 'unsafe.md');
  mkdirSync(join(memoryRoot, 'HOST-EVALS'), { recursive: true });
  writeFileSync(
    artifact,
    memoryDocument('Unsafe transcript').replace('status: active', 'status: complete'),
  );
  const core = join(memoryRoot, 'core.md');
  writeFileSync(core, `${readFileSync(core, 'utf8')}\n- unsafe memory:HOST-EVALS/unsafe\n`);

  const validation = capturedIo();
  assert.throws(() => memoryCheck(runtime, project, validation, { indexed: true }), /issue/i);
  assert.match(validation.errors.join('\n'), /excluded artifact subtree/i);
  assert.throws(
    () => archiveMemory(runtime, project, 'HOST-EVALS/unsafe', {}, capturedIo()),
    /excluded artifact subtree/i,
  );
  writeFileSync(
    core,
    readFileSync(core, 'utf8').replace('\n- unsafe memory:HOST-EVALS/unsafe\n', '\n'),
  );
  const search = capturedIo();
  assert.equal(memorySearch(runtime, project, 'Unsafe transcript', search), 1);
  assert.doesNotMatch(search.logs.join('\n'), /Unsafe transcript/);
});

test('host-evaluation directories are pruned before discovery budgets', () => {
  const root = fixture();
  const project = join(root, 'project');
  mkdirSync(project, { recursive: true });
  execFileSync('git', ['-C', project, 'init', '-q']);
  const runtime = harnessRuntime(root);
  initProject(runtime, project, capturedIo());
  let deep = join(project, '.agent-docs', 'host-evals');
  for (let index = 0; index < 70; index += 1) deep = join(deep, `depth-${index}`);
  mkdirSync(deep, { recursive: true });
  writeFileSync(join(deep, 'transcript.md'), '# Deep redacted transcript\n');

  assert.doesNotThrow(() => memoryCheck(runtime, project, capturedIo(), { indexed: true }));
});

test('uppercase archive aliases fail closed across memory operations', () => {
  const root = fixture();
  const project = join(root, 'project');
  mkdirSync(project, { recursive: true });
  execFileSync('git', ['-C', project, 'init', '-q']);
  const runtime = harnessRuntime(root);
  initProject(runtime, project, capturedIo());
  const archive = join(project, '.agent-docs', '_ARCHIVE');
  mkdirSync(archive);
  writeFileSync(
    join(archive, 'old.md'),
    memoryDocument('Upper archive only').replace('status: active', 'status: complete'),
  );

  const validation = capturedIo();
  assert.throws(() => memoryCheck(runtime, project, validation), /issue/i);
  assert.match(validation.errors.join('\n'), /top-level canonical _archive/i);
  for (const operation of [
    () => memoryList(runtime, project, capturedIo()),
    () => memoryMaintenance(runtime, project, {}, capturedIo()),
    () => memorySearch(runtime, project, 'Upper archive only', capturedIo()),
  ]) {
    assert.throws(operation, /memory (?:check|preflight) failed/i);
  }
});

test('empty or nested archive aliases are still part of the validated managed tree', () => {
  const root = fixture();
  const project = join(root, 'project');
  mkdirSync(project, { recursive: true });
  execFileSync('git', ['-C', project, 'init', '-q']);
  const runtime = harnessRuntime(root);
  initProject(runtime, project, capturedIo());
  mkdirSync(join(project, '.agent-docs', 'working', '_Archive'), { recursive: true });

  const validation = capturedIo();
  assert.throws(() => memoryCheck(runtime, project, validation), /issue/i);
  assert.match(validation.errors.join('\n'), /top-level canonical _archive/i);
});

test('archive location and archived status must agree', () => {
  const root = fixture();
  const project = join(root, 'project');
  mkdirSync(project, { recursive: true });
  execFileSync('git', ['-C', project, 'init', '-q']);
  const runtime = harnessRuntime(root);
  initProject(runtime, project, capturedIo());
  const memoryRoot = join(project, '.agent-docs');
  const archive = join(memoryRoot, '_archive');
  mkdirSync(archive);
  const archivedPath = join(archive, 'old.md');
  writeFileSync(archivedPath, memoryDocument('Wrong archive lifecycle'));

  let validation = capturedIo();
  assert.throws(() => memoryCheck(runtime, project, validation), /issue/i);
  assert.match(validation.errors.join('\n'), /under _archive must have archived status/i);

  writeFileSync(
    archivedPath,
    memoryDocument('Valid archive lifecycle').replace('status: active', 'status: archived'),
  );
  writeFileSync(
    join(memoryRoot, 'misplaced.md'),
    memoryDocument('Misplaced archive lifecycle').replace('status: active', 'status: archived'),
  );
  validation = capturedIo();
  assert.throws(() => memoryCheck(runtime, project, validation), /issue/i);
  assert.match(validation.errors.join('\n'), /archived status must be stored under _archive/i);
});

test('memory validation rejects oversized Markdown before reading its body', () => {
  const root = fixture();
  const project = join(root, 'project');
  mkdirSync(project, { recursive: true });
  execFileSync('git', ['-C', project, 'init', '-q']);
  const runtime = harnessRuntime(root);
  initProject(runtime, project, capturedIo());
  const oversized = join(project, '.agent-docs', 'oversized.md');
  writeFileSync(oversized, '');
  truncateSync(oversized, maximumMemoryDocumentBytes + 1);

  const validation = capturedIo();
  assert.throws(() => memoryCheck(runtime, project, validation), /issue/i);
  assert.match(validation.errors.join('\n'), /document byte budget exceeded/i);
  const listed = capturedIo();
  assert.throws(() => memoryList(runtime, project, listed), /memory check failed/i);
  assert.match(listed.errors.join('\n'), /document byte budget exceeded/i);
});

test.skipIf(process.platform !== 'linux')(
  'portable validation rejects distinct Linux paths that collide after case folding',
  () => {
    const root = fixture();
    const project = join(root, 'project');
    mkdirSync(project, { recursive: true });
    execFileSync('git', ['-C', project, 'init', '-q']);
    const runtime = harnessRuntime(root);
    initProject(runtime, project, capturedIo());
    const memoryRoot = join(project, '.agent-docs');
    const lower = join(memoryRoot, 'case.md');
    const upper = join(memoryRoot, 'CASE.md');
    writeFileSync(lower, memoryDocument('Lower case path'));
    writeFileSync(upper, memoryDocument('Upper case path'));
    const core = join(memoryRoot, 'core.md');
    writeFileSync(
      core,
      `${readFileSync(core, 'utf8')}\n- lower memory:case\n- upper memory:CASE\n`,
    );

    const validation = capturedIo();
    assert.throws(() => memoryCheck(runtime, project, validation), /issue/i);
    assert.match(validation.errors.join('\n'), /portable memory path collision/i);
    assert.throws(
      () => archiveMemory(runtime, project, 'case', { force: true }, capturedIo()),
      /memory check failed/i,
    );
    assert.match(readFileSync(lower, 'utf8'), /Lower case path/);
    assert.match(readFileSync(upper, 'utf8'), /Upper case path/);
  },
);

test('read-only memory commands reject a symlinked memory root', () => {
  const root = fixture();
  const project = join(root, 'project');
  mkdirSync(project, { recursive: true });
  execFileSync('git', ['-C', project, 'init', '-q']);
  const runtime = harnessRuntime(root);
  initProject(runtime, project, capturedIo());
  const memoryRoot = join(project, '.agent-docs');
  const outside = join(root, 'outside-memory');
  renameSync(memoryRoot, outside);
  symlinkSync(outside, memoryRoot, 'dir');

  for (const operation of [
    () => memoryList(runtime, project, capturedIo()),
    () => memoryCheck(runtime, project, capturedIo()),
    () => memorySearch(runtime, project, 'Memory Core', capturedIo()),
    () => memoryMaintenance(runtime, project, {}, capturedIo()),
  ]) {
    assert.throws(operation, /symbolic link/i);
  }
});

test('indexed checks reject symlinked required project and global entries', () => {
  const root = fixture();
  const project = join(root, 'project');
  mkdirSync(project, { recursive: true });
  execFileSync('git', ['-C', project, 'init', '-q']);
  const runtime = harnessRuntime(root);
  initProject(runtime, project, capturedIo());
  initGlobal(runtime, capturedIo());
  const outsideCore = join(root, 'outside-core.md');
  const outsideProfile = join(root, 'outside-profile.md');
  writeFileSync(outsideCore, memoryDocument('Outside core'));
  writeFileSync(outsideProfile, memoryDocument('Outside profile'));
  const projectCore = join(project, '.agent-docs', 'core.md');
  const globalProfile = join(runtime.memoryHome, 'profile.md');
  rmSync(projectCore);
  rmSync(globalProfile);
  symlinkSync(outsideCore, projectCore, 'file');
  symlinkSync(outsideProfile, globalProfile, 'file');

  assert.throws(
    () => memoryCheck(runtime, project, capturedIo(), { indexed: true }),
    /memory check failed/i,
  );
  assert.throws(
    () => memoryCheck(runtime, 'global', capturedIo(), { indexed: true }),
    /memory check failed/i,
  );
});
