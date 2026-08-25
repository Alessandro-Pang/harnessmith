import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { initGlobal, initProject } from '../commands/init.js';
import { captureInput } from '../commands/memory-input.js';
import { maximumMemoryDocumentBytes } from '../lib/memory-path.js';
import { capturedIo, harnessRuntime } from './helpers/harness.js';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'harness-memory-dangling-link-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, 'project');
  mkdirSync(project);
  execFileSync('git', ['-C', project, 'init', '-q']);
  return { project, runtime: harnessRuntime(root) };
}

function assertDanglingLink(path: string, target: string): void {
  assert.equal(lstatSync(path).isSymbolicLink(), true);
  assert.equal(readlinkSync(path), target);
  assert.equal(existsSync(path), false);
}

test('project initialization never replaces a dangling ignore symlink', () => {
  const { project, runtime } = fixture();
  const ignore = join(project, '.gitignore');
  symlinkSync('missing-ignore-target', ignore);

  assert.throws(
    () =>
      captureInput(
        runtime,
        project,
        { title: 'Unsafe initialization', content: 'Do not replace links.', source: 'chat' },
        capturedIo(),
      ),
    /symbolic link/i,
  );
  assertDanglingLink(ignore, 'missing-ignore-target');
  assert.equal(existsSync(join(project, '.agent-docs')), false);
});

test('typed capture never replaces a dangling project core symlink', () => {
  const { project, runtime } = fixture();
  initProject(runtime, project, capturedIo());
  const core = join(project, '.agent-docs', 'core.md');
  rmSync(core);
  symlinkSync('missing-core-target', core);

  assert.throws(
    () =>
      captureInput(
        runtime,
        project,
        { title: 'Unsafe core', content: 'Preserve the dangling link.', source: 'chat' },
        capturedIo(),
      ),
    /symbolic link/i,
  );
  assertDanglingLink(core, 'missing-core-target');
});

test('global initialization never replaces a dangling profile symlink', () => {
  const { runtime } = fixture();
  initGlobal(runtime, capturedIo());
  const profile = join(runtime.memoryHome, 'profile.md');
  rmSync(profile);
  symlinkSync('missing-profile-target', profile);

  assert.throws(() => initGlobal(runtime, capturedIo()), /symbolic link/i);
  assertDanglingLink(profile, 'missing-profile-target');
});

test('snapshot failure does not leave a newly created project memory root', () => {
  const { project, runtime } = fixture();
  const ignore = join(project, '.gitignore');
  writeFileSync(ignore, '');
  truncateSync(ignore, maximumMemoryDocumentBytes + 1);
  const before = statSync(ignore).size;

  assert.throws(
    () =>
      captureInput(
        runtime,
        project,
        { title: 'Oversized ignore', content: 'Do not leave scaffolding.', source: 'chat' },
        capturedIo(),
      ),
    /exceeds .* bytes/i,
  );
  assert.equal(statSync(ignore).size, before);
  assert.equal(existsSync(join(project, '.agent-docs')), false);
});
