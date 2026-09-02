import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { beforeEach, onTestFinished, test, vi } from 'vitest';

const removal = vi.hoisted(() => ({
  failExact: new Set<string>(),
  failTransactionRoot: false,
}));

vi.mock('../shared/files.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../shared/files.js')>();
  return {
    ...actual,
    removeExact(path: string) {
      if (
        removal.failExact.has(path) ||
        (removal.failTransactionRoot && basename(path).startsWith('harnesssmith-lifecycle-'))
      ) {
        throw new Error(`injected cleanup failure: ${path}`);
      }
      actual.removeExact(path);
    },
  };
});

vi.mock('../temporary-resources/temporary-resource.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../temporary-resources/temporary-resource.js')>();
  return {
    ...actual,
    disposeTemporaryWorkspace(workspace: { path: string }) {
      if (
        removal.failTransactionRoot &&
        basename(workspace.path).startsWith('harnessmith-lifecycle-')
      ) {
        throw new Error(`injected cleanup failure: ${workspace.path}`);
      }
      actual.disposeTemporaryWorkspace(workspace as never);
    },
  };
});

import {
  LifecycleRecoveryError,
  lifecycleTransaction,
} from '../installation/lifecycle-transaction.js';

beforeEach(() => {
  removal.failExact.clear();
  removal.failTransactionRoot = false;
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-transaction-failure-'));
  const workspace = join(root, 'workspace');
  mkdirSync(workspace);
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  return { root, workspace };
}

test('recovery registration accepts only transaction roots and can be withdrawn', () => {
  const { root, workspace } = fixture();
  const target = join(workspace, 'target.txt');
  writeFileSync(target, 'before\n');

  assert.throws(
    () =>
      lifecycleTransaction([{ root: workspace, path: target }], (context) =>
        context.registerRecoveryPath(root, join(root, 'outside-stage')),
      ),
    /root is not part of the lifecycle transaction/,
  );
  assert.equal(
    lifecycleTransaction(
      [
        { root: workspace, path: target },
        { root: workspace, path: join(workspace, 'missing.txt') },
      ],
      (context) => {
        const unregister = context.registerRecoveryPath(workspace, join(workspace, 'stage'));
        unregister();
        return 'complete';
      },
    ),
    'complete',
  );
});

test('operation failure reports a retained recovery stage when its cleanup fails', () => {
  const { workspace } = fixture();
  const target = join(workspace, 'target.txt');
  const stage = join(workspace, 'restore-stage');
  writeFileSync(target, 'before\n');
  mkdirSync(stage);
  removal.failExact.add(stage);

  let caught: unknown;
  try {
    lifecycleTransaction([{ root: workspace, path: target }], (context) => {
      context.registerRecoveryPath(workspace, stage);
      writeFileSync(target, 'after\n');
      throw new Error('operation failed');
    });
  } catch (error) {
    caught = error;
  }

  assert.ok(caught instanceof LifecycleRecoveryError);
  assert.match(caught.message, /rollback completed but recovery cleanup was incomplete/);
  assert.ok(caught.recoveryPaths.includes(stage));
  assert.equal(existsSync(stage), true);
  for (const path of caught.recoveryPaths) rmSync(path, { recursive: true, force: true });
});

test('operation failure reports a retained snapshot when transaction cleanup fails', () => {
  const { workspace } = fixture();
  const target = join(workspace, 'target.txt');
  writeFileSync(target, 'before\n');
  removal.failTransactionRoot = true;

  let caught: unknown;
  try {
    lifecycleTransaction([{ root: workspace, path: target }], () => {
      writeFileSync(target, 'after\n');
      throw new Error('operation failed');
    });
  } catch (error) {
    caught = error;
  }

  assert.ok(caught instanceof LifecycleRecoveryError);
  assert.match(caught.message, /transaction cleanup was incomplete/);
  assert.equal(caught.recoveryPaths.length, 1);
  assert.equal(existsSync(caught.recoveryPaths[0]), true);
  rmSync(caught.recoveryPaths[0], { recursive: true, force: true });
});

test('successful operation reports recovery cleanup failures', () => {
  const { workspace } = fixture();
  const target = join(workspace, 'target.txt');
  const stage = join(workspace, 'restore-stage');
  writeFileSync(target, 'before\n');
  mkdirSync(stage);
  removal.failExact.add(stage);

  let caught: unknown;
  try {
    lifecycleTransaction([{ root: workspace, path: target }], (context) => {
      context.registerRecoveryPath(workspace, stage);
      return 'complete';
    });
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof LifecycleRecoveryError);
  assert.match(caught.message, /operation completed but recovery cleanup was incomplete/);
  for (const path of caught.recoveryPaths) rmSync(path, { recursive: true, force: true });
});

test('successful operation reports transaction cleanup failures', () => {
  const { workspace } = fixture();
  const target = join(workspace, 'target.txt');
  writeFileSync(target, 'before\n');
  removal.failTransactionRoot = true;

  let caught: unknown;
  try {
    lifecycleTransaction([{ root: workspace, path: target }], () => 'complete');
  } catch (error) {
    caught = error;
  }

  assert.ok(caught instanceof LifecycleRecoveryError);
  assert.match(caught.message, /operation completed but transaction cleanup was incomplete/);
  assert.equal(caught.cause instanceof Error, true);
  for (const path of caught.recoveryPaths) rmSync(path, { recursive: true, force: true });
});

test('snapshot creation reports retained data when its cleanup fails', () => {
  const { root, workspace } = fixture();
  const target = join(workspace, 'target.txt');
  const outside = join(root, 'outside.txt');
  writeFileSync(target, 'before\n');
  writeFileSync(outside, 'outside\n');
  removal.failTransactionRoot = true;

  let caught: unknown;
  try {
    lifecycleTransaction(
      [
        { root: workspace, path: target },
        { root: workspace, path: outside },
      ],
      () => 'never',
    );
  } catch (error) {
    caught = error;
  }

  assert.ok(caught instanceof LifecycleRecoveryError);
  assert.match(caught.message, /snapshot creation failed and cleanup was incomplete/);
  assert.equal(caught.recoveryPaths.length, 1);
  assert.equal(existsSync(caught.recoveryPaths[0]), true);
  rmSync(caught.recoveryPaths[0], { recursive: true, force: true });
});
