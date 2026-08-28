import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { initGlobal } from '../commands/init.js';
import { captureHandoff } from '../commands/memory-autopilot.js';
import { reconcileProfile } from '../commands/memory-profile.js';
import { writeValidated } from '../lib/memory-write.js';
import { withUserDataCoordinationLocks } from '../lib/user-data-lock.js';
import { assertMode, capturedIo, harnessRuntime } from './helpers/harness.js';

function temporaryRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test('validated memory writes reject a symlinked destination before touching its target', () => {
  const root = temporaryRoot('harness-memory-write-symlink-');
  const memoryRoot = join(root, 'memory');
  const outside = join(root, 'outside.md');
  const destination = join(memoryRoot, 'profile.md');
  mkdirSync(memoryRoot, { recursive: true });
  writeFileSync(outside, 'outside content\n');
  symlinkSync(outside, destination, 'file');

  assert.throws(
    () =>
      writeValidated(
        memoryRoot,
        [{ path: destination, content: 'unexpected replacement\n' }],
        capturedIo(),
      ),
    /symbolic link/i,
  );
  assert.equal(readFileSync(outside, 'utf8'), 'outside content\n');
});

test('global profile route repair rejects a symlinked core before touching its target', () => {
  const root = temporaryRoot('harness-global-route-symlink-');
  const runtime = harnessRuntime(root);
  initGlobal(runtime, capturedIo());
  const core = join(runtime.memoryHome, 'core.md');
  const outside = join(root, 'outside-core.md');
  rmSync(core);
  writeFileSync(outside, 'legacy core without a profile route\n');
  symlinkSync(outside, core, 'file');

  assert.throws(() => initGlobal(runtime, capturedIo()), /symbolic link/i);
  assert.equal(readFileSync(outside, 'utf8'), 'legacy core without a profile route\n');
});

test('validated memory writes preflight every entry and reject a symlinked parent directory', () => {
  const root = temporaryRoot('harness-memory-write-parent-symlink-');
  const memoryRoot = join(root, 'memory');
  const outside = join(root, 'outside');
  const safe = join(memoryRoot, 'core.md');
  mkdirSync(memoryRoot, { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(safe, 'original core\n');
  symlinkSync(outside, join(memoryRoot, 'sessions'), 'dir');

  assert.throws(
    () =>
      writeValidated(
        memoryRoot,
        [
          { path: safe, content: 'must not be written\n' },
          { path: join(memoryRoot, 'sessions', 'escaped.md'), content: 'escaped\n' },
        ],
        capturedIo(),
      ),
    /symbolic link/i,
  );
  assert.equal(readFileSync(safe, 'utf8'), 'original core\n');
  assert.equal(existsSync(join(outside, 'escaped.md')), false);
});

test('global profile route repair requires the exact canonical reference', () => {
  const root = temporaryRoot('harness-global-route-exact-');
  const runtime = harnessRuntime(root);
  initGlobal(runtime, capturedIo());
  const core = join(runtime.memoryHome, 'core.md');
  writeFileSync(
    join(runtime.memoryHome, 'profile-old.md'),
    readFileSync(join(runtime.memoryHome, 'README.md'), 'utf8'),
  );
  writeFileSync(core, readFileSync(core, 'utf8').replace('memory:profile', 'memory:profile-old'));

  initGlobal(runtime, capturedIo());

  const repaired = readFileSync(core, 'utf8');
  assert.match(repaired, /memory:profile-old/);
  assert.match(repaired, /`memory:profile`/);
});

test('global memory initialization creates and tightens private filesystem modes', () => {
  const root = temporaryRoot('harness-global-private-modes-');
  const runtime = harnessRuntime(root);
  initGlobal(runtime, capturedIo());
  const entries = ['README.md', 'core.md', 'profile.md'].map((name) =>
    join(runtime.memoryHome, name),
  );
  assertMode(runtime.memoryHome, 0o700);
  for (const path of entries) assertMode(path, 0o600);

  chmodSync(runtime.memoryHome, 0o755);
  for (const path of entries) chmodSync(path, 0o644);
  initGlobal(runtime, capturedIo());

  assertMode(runtime.memoryHome, 0o700);
  for (const path of entries) assertMode(path, 0o600);
});

test('failed profile reconciliation rolls back global initialization route repairs', () => {
  const root = temporaryRoot('harness-global-init-rollback-');
  const runtime = harnessRuntime(root);
  initGlobal(runtime, capturedIo());
  const core = join(runtime.memoryHome, 'core.md');
  const baseline = readFileSync(core, 'utf8').replace(
    '- 需要理解用户身份、工作方式、技术背景或当前兴趣时读取 `memory:profile`。',
    '',
  );
  writeFileSync(core, baseline);
  writeFileSync(join(runtime.memoryHome, 'invalid.md'), 'missing frontmatter\n');

  assert.throws(
    () =>
      reconcileProfile(
        runtime,
        {
          key: 'communication.rollback',
          conclusion: 'Do not retain partial initialization.',
          evidence: 'explicit',
          confidence: 'high',
        },
        capturedIo(),
      ),
    /memory check failed/i,
  );
  assert.equal(readFileSync(core, 'utf8'), baseline);
});

test('contended global initialization does not leave an absent memory root behind', () => {
  const root = temporaryRoot('harness-global-init-contention-');
  const runtime = harnessRuntime(root);

  withUserDataCoordinationLocks([runtime.memoryHome], [], () => {
    assert.throws(() => initGlobal(runtime, capturedIo()), /being initialized by another process/i);
    assert.equal(existsSync(runtime.memoryHome), false);
  });
});

test('global initialization rejects a symlinked memory root before creating any files', () => {
  const root = temporaryRoot('harness-global-root-symlink-');
  const runtime = harnessRuntime(root);
  const outside = join(root, 'outside');
  mkdirSync(outside, { recursive: true });
  symlinkSync(outside, runtime.memoryHome, 'dir');

  assert.throws(() => initGlobal(runtime, capturedIo()), /symbolic link/i);
  assert.deepEqual(existsSync(join(outside, 'README.md')), false);
  assert.deepEqual(existsSync(join(outside, 'core.md')), false);
  assert.deepEqual(existsSync(join(outside, 'profile.md')), false);
});

test('validated memory writes preserve hardened modes on success and rollback', () => {
  const root = temporaryRoot('harness-memory-write-mode-');
  const runtime = harnessRuntime(root);
  initGlobal(runtime, capturedIo());
  const profile = join(runtime.memoryHome, 'profile.md');
  const original = readFileSync(profile, 'utf8');
  chmodSync(profile, 0o600);

  writeValidated(runtime.memoryHome, [{ path: profile, content: original }], capturedIo());
  assertMode(profile, 0o600);

  assert.throws(
    () =>
      writeValidated(
        runtime.memoryHome,
        [{ path: profile, content: 'invalid memory\n' }],
        capturedIo(),
      ),
    /memory check failed/i,
  );
  assert.equal(readFileSync(profile, 'utf8'), original);
  assertMode(profile, 0o600);
});

test('project capture rejects a symlinked managed core on the unchanged fast path', () => {
  const root = temporaryRoot('harness-project-core-symlink-');
  const project = join(root, 'project');
  mkdirSync(project, { recursive: true });
  execFileSync('git', ['-C', project, 'init', '-q']);
  const runtime = harnessRuntime(root);
  const options = {
    session: 'symlink-fast-path',
    title: 'Symlink fast path',
    objective: 'Reject unsafe managed entries.',
    completed: 'Created the baseline.',
    next: 'Repeat the same capture.',
    reason: 'phase' as const,
  };
  captureHandoff(runtime, project, options, capturedIo());
  const core = join(project, '.agent-docs', 'core.md');
  const outside = join(root, 'outside-core.md');
  writeFileSync(outside, readFileSync(core, 'utf8'));
  rmSync(core);
  symlinkSync(outside, core, 'file');
  const baseline = readFileSync(outside, 'utf8');

  assert.throws(() => captureHandoff(runtime, project, options, capturedIo()), /symbolic link/i);
  assert.equal(readFileSync(outside, 'utf8'), baseline);
});

test('validation rollback removes only empty directories created by the failed write', () => {
  const root = temporaryRoot('harness-memory-write-directory-rollback-');
  const runtime = harnessRuntime(root);
  initGlobal(runtime, capturedIo());
  const nested = join(runtime.memoryHome, 'sessions', '2000', '01', 'invalid.md');

  assert.throws(
    () =>
      writeValidated(runtime.memoryHome, [{ path: nested, content: 'invalid\n' }], capturedIo()),
    /memory check failed/i,
  );
  assert.equal(existsSync(join(runtime.memoryHome, 'sessions')), false);
});
