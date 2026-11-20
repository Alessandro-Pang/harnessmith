import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'vitest';
import { elementAt } from '../../../../packages/harness/src/__tests__/helpers/harness.js';
import { lifecycleTransaction } from '../installation/lifecycle-transaction.js';

interface RecoveryError extends Error {
  recoveryPaths?: string[];
}

function withIsolatedTmp<T>(operation: (root: string, transactionTmp: string) => T): T {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-transaction-test-'));
  const transactionTmp = join(root, 'tmp');
  mkdirSync(transactionTmp);
  const names = ['TMPDIR', 'TMP', 'TEMP'] as const;
  const previous = new Map(names.map((name) => [name, process.env[name]]));
  for (const name of names) process.env[name] = transactionTmp;
  try {
    assert.equal(resolve(tmpdir()), resolve(transactionTmp));
    return operation(root, transactionTmp);
  } finally {
    for (const name of names) {
      const value = previous.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(root, { recursive: true, force: true });
  }
}

test('snapshot creation removes partial transaction data when a later path is unsafe', () => {
  withIsolatedTmp((root, transactionTmp) => {
    const workspace = join(root, 'workspace');
    const first = join(workspace, 'first.txt');
    const outside = join(root, 'outside.txt');
    mkdirSync(workspace);
    writeFileSync(first, 'first snapshot\n');
    writeFileSync(outside, 'outside\n');
    let operated = false;

    assert.throws(
      () =>
        lifecycleTransaction(
          [
            { root: workspace, path: first },
            { root: workspace, path: outside },
          ],
          () => {
            operated = true;
          },
        ),
      /Unsafe path escapes/,
    );

    assert.equal(operated, false);
    assert.deepEqual(readdirSync(transactionTmp), []);
  });
});

test('rollback failure retains the exact snapshots and reports the recovery path', () => {
  withIsolatedTmp((root) => {
    const workspace = join(root, 'workspace');
    const first = join(workspace, 'first.txt');
    const nested = join(workspace, 'nested');
    const second = join(nested, 'second.txt');
    mkdirSync(nested, { recursive: true });
    writeFileSync(first, 'first snapshot\n');
    writeFileSync(second, 'second snapshot\n');

    let caught: RecoveryError | undefined;
    try {
      lifecycleTransaction(
        [
          { root: workspace, path: first },
          { root: workspace, path: second },
        ],
        () => {
          rmSync(first);
          rmSync(second);
          rmSync(nested, { recursive: true });
          writeFileSync(nested, 'blocks rollback mkdir\n');
          throw new Error('injected lifecycle failure');
        },
      );
    } catch (error) {
      caught = error as RecoveryError;
    }

    assert.ok(caught);
    assert.match(caught.message, /rollback was incomplete/i);
    assert.match(caught.message, /recovery/i);
    assert.ok(Array.isArray(caught.recoveryPaths));
    const transactionRoot = elementAt(caught.recoveryPaths, 0);
    assert.equal(existsSync(transactionRoot), true);
    assert.equal(readFileSync(join(transactionRoot, '0'), 'utf8'), 'first snapshot\n');
    assert.equal(readFileSync(join(transactionRoot, '1'), 'utf8'), 'second snapshot\n');
    assert.equal(readFileSync(first, 'utf8'), 'first snapshot\n');
  });
});

test('operation failure restores exact file content and mode, then removes the snapshot', () => {
  withIsolatedTmp((root, transactionTmp) => {
    const workspace = join(root, 'workspace');
    const target = join(workspace, 'managed.txt');
    const missing = join(workspace, 'missing.txt');
    mkdirSync(workspace);
    writeFileSync(target, 'before\n');
    chmodSync(target, 0o600);

    assert.throws(
      () =>
        lifecycleTransaction(
          [
            { root: workspace, path: target },
            { root: workspace, path: missing },
          ],
          () => {
            writeFileSync(target, 'after\n');
            chmodSync(target, 0o644);
            writeFileSync(missing, 'created during operation\n');
            throw new Error('injected lifecycle failure');
          },
        ),
      /injected lifecycle failure/,
    );

    assert.equal(readFileSync(target, 'utf8'), 'before\n');
    assert.equal(statSync(target).mode & 0o777, 0o600);
    assert.equal(existsSync(missing), false, 'paths absent at snapshot time are removed again');
    assert.deepEqual(readdirSync(transactionTmp), []);
  });
});

test('successful lifecycle transaction removes its snapshot', () => {
  withIsolatedTmp((root, transactionTmp) => {
    const workspace = join(root, 'workspace');
    const target = join(workspace, 'managed.txt');
    mkdirSync(workspace);
    writeFileSync(target, 'before\n');

    const result = lifecycleTransaction([{ root: workspace, path: target }], () => 'complete');

    assert.equal(result, 'complete');
    assert.deepEqual(readdirSync(transactionTmp), []);
  });
});

test('snapshot refuses a symlink at a managed path before any mutation', () => {
  withIsolatedTmp((root, transactionTmp) => {
    const workspace = join(root, 'workspace');
    const target = join(workspace, 'dangling');
    mkdirSync(workspace);
    symlinkSync('missing-root-target', target);
    let operated = false;

    assert.throws(
      () =>
        lifecycleTransaction([{ root: workspace, path: target }], () => {
          operated = true;
        }),
      /symbolic link/i,
    );

    assert.equal(operated, false);
    assert.equal(lstatSync(target).isSymbolicLink(), true);
    assert.deepEqual(readdirSync(transactionTmp), []);
  });
});

test('snapshot refuses a directory at a managed path before any mutation', () => {
  withIsolatedTmp((root, transactionTmp) => {
    const workspace = join(root, 'workspace');
    const tree = join(workspace, 'tree');
    mkdirSync(tree, { recursive: true });
    writeFileSync(join(tree, 'child.txt'), 'child\n');
    let operated = false;

    assert.throws(
      () =>
        lifecycleTransaction([{ root: workspace, path: tree }], () => {
          operated = true;
        }),
      /Unsupported lifecycle snapshot entry/,
    );

    assert.equal(operated, false);
    assert.equal(readFileSync(join(tree, 'child.txt'), 'utf8'), 'child\n');
    assert.deepEqual(readdirSync(transactionTmp), []);
  });
});
