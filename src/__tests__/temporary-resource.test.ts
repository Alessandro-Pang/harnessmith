import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import {
  createTemporaryWorkspace,
  disposeTemporaryWorkspace,
  scanTemporaryResourceRoots,
  scanTemporaryResources,
  withTemporaryWorkspace,
} from '../temporary-resource.js';

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-temp-resource-test-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  return realpathSync.native(root);
}

test('operation-scoped workspaces carry ownership and are disposed after success', () => {
  const base = fixture();
  let workspacePath = '';

  const result = withTemporaryWorkspace(
    {
      base,
      owner: 'preflight',
      purpose: 'clean-room',
      lifecycle: 'operation',
    },
    (workspace) => {
      workspacePath = workspace.path;
      const marker = JSON.parse(readFileSync(workspace.markerPath, 'utf8')) as {
        owner?: string;
        purpose?: string;
        lifecycle?: string;
      };
      assert.equal(marker.owner, 'preflight');
      assert.equal(marker.purpose, 'clean-room');
      assert.equal(marker.lifecycle, 'operation');
      writeFileSync(join(workspace.path, 'result.txt'), 'verified');
      return 'completed';
    },
  );

  assert.equal(result, 'completed');
  assert.equal(existsSync(workspacePath), false);
});

test('operation failures clean by default and preserve the original error', () => {
  const base = fixture();
  let workspacePath = '';
  const failure = new Error('verification failed');

  assert.throws(
    () =>
      withTemporaryWorkspace(
        { base, owner: 'eval', purpose: 'host-eval', lifecycle: 'operation' },
        (workspace) => {
          workspacePath = workspace.path;
          throw failure;
        },
      ),
    (error: unknown) => error === failure,
  );
  assert.equal(existsSync(workspacePath), false);
});

test('explicit recovery retention reports the exact managed path and reason', () => {
  const base = fixture();
  let workspacePath = '';

  assert.throws(
    () =>
      withTemporaryWorkspace(
        {
          base,
          owner: 'release',
          purpose: 'clean-room',
          lifecycle: 'retained-for-recovery',
          retainOnFailure: true,
        },
        (workspace) => {
          workspacePath = workspace.path;
          throw new Error('registry verification failed');
        },
      ),
    (error: unknown) => {
      assert.match(String(error), /registry verification failed/);
      assert.match(
        String(error),
        new RegExp(workspacePath.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      );
      return true;
    },
  );
  assert.equal(existsSync(workspacePath), true);
});

test('cleanup refuses changed ownership markers and reports the retained path', () => {
  const base = fixture();
  const workspace = createTemporaryWorkspace({
    base,
    owner: 'preflight',
    purpose: 'validation',
    lifecycle: 'operation',
  });
  writeFileSync(workspace.markerPath, '{}');

  assert.throws(
    () => disposeTemporaryWorkspace(workspace),
    (error: unknown) => {
      assert.match(String(error), /marker|identity|cleanup/i);
      assert.match(
        String(error),
        new RegExp(workspace.path.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      );
      return true;
    },
  );
  assert.equal(existsSync(workspace.path), true);
});

test('dry-run scanning lists only managed workspaces and lock targets without deleting them', () => {
  const base = fixture();
  const managed = createTemporaryWorkspace({
    base,
    owner: 'eval',
    purpose: 'host-eval',
    lifecycle: 'workstream',
  });
  const unknown = join(base, 'harnessmith-unknown');
  mkdirSync(unknown);
  const namespace = join(base, 'harnessmith-user-data-locks-test');
  const lockTarget = join(namespace, 'a'.repeat(64));
  mkdirSync(lockTarget, { recursive: true });

  const report = scanTemporaryResources({ root: base });

  assert.deepEqual(
    report.resources.map(({ kind, path }) => ({ kind, path })),
    [
      { kind: 'workspace', path: managed.path },
      { kind: 'lock-target', path: lockTarget },
    ],
  );
  assert.equal(report.resources[0]?.active, true);
  assert.equal(existsSync(managed.path), true);
  assert.equal(existsSync(lockTarget), true);
  assert.equal(existsSync(unknown), true);
});

test('default dry-run covers the OS workspace root and the stable POSIX lock namespace root', () => {
  const report = scanTemporaryResourceRoots({ maxEntries: 1 });
  const expected = new Set([realpathSync.native(tmpdir())]);
  if (process.platform !== 'win32') expected.add(realpathSync.native('/tmp'));

  assert.deepEqual(new Set(report.roots), expected);
  assert.equal(report.action, 'dry-run');
});

test('dry-run caps listed resources and marks a truncated report', () => {
  const base = fixture();
  for (const suffix of ['a', 'b', 'c']) {
    const namespace = join(base, `harnessmith-user-data-locks-${suffix}`);
    mkdirSync(join(namespace, suffix.repeat(64)), { recursive: true });
  }

  const report = scanTemporaryResources({ root: base, maxResults: 1 });

  assert.equal(report.resources.length, 1);
  assert.equal(report.truncated, true);
});
