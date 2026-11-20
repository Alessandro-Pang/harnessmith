import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'vitest';
import { temporaryDirectory } from './run-fixture.js';

async function snapshotModule() {
  return import(
    // @ts-expect-error Plain ESM evaluator module added with the regression.
    '../../scripts/evaluation/codex/support/safe-snapshot.mjs'
  );
}

test('F07 safe snapshots hash regular files without following paths', async () => {
  const root = temporaryDirectory();
  mkdirSync(join(root, 'nested'));
  writeFileSync(join(root, 'nested', 'memory.md'), 'safe local memory\n');
  writeFileSync(join(root, 'ignored.lock'), 'lock');
  const { snapshotRegularFileTree } = await snapshotModule();

  const snapshot = snapshotRegularFileTree(root, {
    includeContent: true,
    ignore: (path: string) => path.endsWith('.lock'),
  });

  assert.equal(snapshot['nested/memory.md'].content, 'safe local memory\n');
  assert.match(snapshot['nested/memory.md'].sha256, /^[a-f0-9]{64}$/u);
  assert.equal(snapshot['ignored.lock'], undefined);
  assert.deepEqual(snapshotRegularFileTree(join(root, 'missing')), {});
});

test.skipIf(process.platform === 'win32')(
  'F07 file and directory symlinks fail without exposing external sentinel content',
  async () => {
    const outside = temporaryDirectory();
    const sentinel = 'SAFE_EXTERNAL_SENTINEL_NOT_A_SECRET';
    writeFileSync(join(outside, 'outside.txt'), sentinel);
    for (const kind of ['file', 'directory'] as const) {
      const root = temporaryDirectory();
      const target = kind === 'file' ? join(outside, 'outside.txt') : outside;
      symlinkSync(target, join(root, 'escape'), kind === 'file' ? 'file' : 'dir');
      const { snapshotRegularFileTree } = await snapshotModule();

      assert.throws(
        () => snapshotRegularFileTree(root, { includeContent: true }),
        (error: unknown) => {
          assert.match(String(error), /symlink|regular file/i);
          assert.equal(String(error).includes(sentinel), false);
          return true;
        },
      );
    }
  },
);

test('F07 traversal enforces depth, file count, single-file, and aggregate byte budgets', async () => {
  const { snapshotRegularFileTree } = await snapshotModule();
  const depthRoot = temporaryDirectory();
  mkdirSync(join(depthRoot, 'a', 'b'), { recursive: true });
  writeFileSync(join(depthRoot, 'a', 'b', 'file.txt'), 'x');
  assert.throws(() => snapshotRegularFileTree(depthRoot, { maxDepth: 1 }), /depth/i);

  const countRoot = temporaryDirectory();
  writeFileSync(join(countRoot, 'one.txt'), '1');
  writeFileSync(join(countRoot, 'two.txt'), '2');
  assert.throws(() => snapshotRegularFileTree(countRoot, { maxFiles: 1 }), /file count/i);

  const fileBytesRoot = temporaryDirectory();
  writeFileSync(join(fileBytesRoot, 'large.txt'), '12345');
  assert.throws(() => snapshotRegularFileTree(fileBytesRoot, { maxFileBytes: 4 }), /file.*byte/i);

  const totalBytesRoot = temporaryDirectory();
  writeFileSync(join(totalBytesRoot, 'one.txt'), '123');
  writeFileSync(join(totalBytesRoot, 'two.txt'), '456');
  assert.throws(
    () => snapshotRegularFileTree(totalBytesRoot, { maxTotalBytes: 5 }),
    /total.*byte/i,
  );
});

test('F07 ordinary .lock files and lock-named directories stay visible to the forbidden contract', async () => {
  const root = temporaryDirectory();
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'deps.lock'), 'version 1\n');
  writeFileSync(join(root, 'src', 'build.lock'), 'version 1\n');
  mkdirSync(join(root, 'cache.lock'));
  writeFileSync(join(root, 'cache.lock', 'data.bin'), 'payload');
  // Harness locks are empty proper-lockfile directories; they must not mask real content.
  mkdirSync(join(root, '.agent-docs.lock'));
  const { snapshotRegularFileTree, evaluateRepositoryForbiddenContract } = await snapshotModule();

  const before = snapshotRegularFileTree(root);
  assert.match(before['deps.lock'].sha256, /^[a-f0-9]{64}$/u);
  assert.match(before['src/build.lock'].sha256, /^[a-f0-9]{64}$/u);
  assert.match(before['cache.lock/data.bin'].sha256, /^[a-f0-9]{64}$/u);
  assert.equal(before['.agent-docs.lock'], undefined);

  writeFileSync(join(root, 'deps.lock'), 'version 2\n');
  writeFileSync(join(root, 'src', 'build.lock'), 'version 2\n');
  writeFileSync(join(root, 'cache.lock', 'data.bin'), 'tampered');
  const contract = evaluateRepositoryForbiddenContract({
    before,
    after: snapshotRegularFileTree(root),
    allowedPrefixes: ['.agent-docs/', '.harness-eval-tmp/'],
  });
  assert.equal(contract.outcome, 'failed');
  assert.equal(contract.criticalForbidden, true);
  assert.deepEqual(contract.changedPaths, ['cache.lock/data.bin', 'deps.lock', 'src/build.lock']);
});

test.skipIf(process.platform === 'win32')(
  'F07 lock-named symlinks are rejected instead of ignored',
  async () => {
    const outside = temporaryDirectory();
    writeFileSync(join(outside, 'target.txt'), 'external');
    for (const kind of ['file', 'directory'] as const) {
      const root = temporaryDirectory();
      const target = kind === 'file' ? join(outside, 'target.txt') : outside;
      symlinkSync(target, join(root, 'escape.lock'), kind === 'file' ? 'file' : 'dir');
      const { snapshotRegularFileTree } = await snapshotModule();
      assert.throws(() => snapshotRegularFileTree(root), /symlink|regular file/i);
    }
  },
);

test.skipIf(process.platform === 'win32')(
  'F07 snapshots record the Git executable bit and mode-only changes are forbidden',
  async () => {
    const root = temporaryDirectory();
    const script = join(root, 'script.sh');
    writeFileSync(script, '#!/bin/sh\necho ok\n');
    chmodSync(script, 0o644);
    const { snapshotRegularFileTree, evaluateRepositoryForbiddenContract } = await snapshotModule();

    const before = snapshotRegularFileTree(root);
    assert.equal(before['script.sh'].executable, false);
    chmodSync(script, 0o755);
    const after = snapshotRegularFileTree(root);
    assert.equal(after['script.sh'].executable, true);
    assert.equal(after['script.sh'].sha256, before['script.sh'].sha256);

    const contract = evaluateRepositoryForbiddenContract({ before, after });
    assert.equal(contract.outcome, 'failed');
    assert.equal(contract.criticalForbidden, true);
    assert.deepEqual(contract.changedPaths, ['script.sh']);
  },
);

test.skipIf(process.platform === 'win32')(
  'F07 non-executable permission drift does not create spurious changes',
  async () => {
    const root = temporaryDirectory();
    const file = join(root, 'notes.txt');
    writeFileSync(file, 'stable content\n');
    chmodSync(file, 0o644);
    const { snapshotRegularFileTree, evaluateRepositoryForbiddenContract } = await snapshotModule();
    const before = snapshotRegularFileTree(root);
    chmodSync(file, 0o600);
    const contract = evaluateRepositoryForbiddenContract({
      before,
      after: snapshotRegularFileTree(root),
    });
    assert.equal(contract.outcome, 'passed');
    assert.deepEqual(contract.changedPaths, []);
  },
);

test('F07 contract normalizes legacy snapshot entries without mode information', async () => {
  const { evaluateRepositoryForbiddenContract } = await snapshotModule();
  const legacy = { 'script.sh': { size: 3, sha256: 'a'.repeat(64) } };
  const unchanged = { 'script.sh': { size: 3, sha256: 'a'.repeat(64), executable: false } };
  const flipped = { 'script.sh': { size: 3, sha256: 'a'.repeat(64), executable: true } };
  assert.equal(
    evaluateRepositoryForbiddenContract({ before: legacy, after: unchanged }).outcome,
    'passed',
  );
  const contract = evaluateRepositoryForbiddenContract({ before: legacy, after: flipped });
  assert.equal(contract.outcome, 'failed');
  assert.deepEqual(contract.changedPaths, ['script.sh']);
});
