import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'vitest';
import { lifecycleTransaction } from '../installation/lifecycle-transaction.js';

interface RecoveryError extends Error {
  recoveryPaths?: string[];
}

interface TransactionContext {
  registerRecoveryPath(root: string, path: string): () => void;
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

test('rollback failure retains the transaction snapshot and reports every recovery path', () => {
  withIsolatedTmp((root) => {
    const workspace = join(root, 'workspace');
    const first = join(workspace, 'first.txt');
    const nested = join(workspace, 'nested');
    const second = join(nested, 'second.txt');
    const restoreStage = join(workspace, '.harnessmith-restore-audit');
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
        ((context?: TransactionContext) => {
          mkdirSync(restoreStage);
          context?.registerRecoveryPath(workspace, restoreStage);
          rmSync(first);
          rmSync(second);
          rmdirSync(nested);
          writeFileSync(nested, 'blocks rollback mkdir\n');
          throw new Error('injected lifecycle failure');
        }) as () => never,
      );
    } catch (error) {
      caught = error as RecoveryError;
    }

    assert.ok(caught);
    assert.match(caught.message, /rollback was incomplete/i);
    assert.match(caught.message, /recovery/i);
    assert.ok(Array.isArray(caught.recoveryPaths));
    assert.ok(caught.recoveryPaths.includes(restoreStage));
    const transactionRoot = caught.recoveryPaths[0];
    assert.equal(existsSync(transactionRoot), true);
    assert.equal(readFileSync(join(transactionRoot, '0'), 'utf8'), 'first snapshot\n');
    assert.equal(readFileSync(join(transactionRoot, '1'), 'utf8'), 'second snapshot\n');
    assert.equal(readFileSync(first, 'utf8'), 'first snapshot\n');
    assert.equal(existsSync(restoreStage), true);
  });
});

test('successful transaction rollback removes a registered restore stage', () => {
  withIsolatedTmp((root, transactionTmp) => {
    const workspace = join(root, 'workspace');
    const target = join(workspace, 'managed.txt');
    const restoreStage = join(workspace, '.harnessmith-restore-audit');
    mkdirSync(workspace);
    writeFileSync(target, 'before\n');

    assert.throws(
      () =>
        lifecycleTransaction([{ root: workspace, path: target }], ((
          context?: TransactionContext,
        ) => {
          mkdirSync(restoreStage);
          context?.registerRecoveryPath(workspace, restoreStage);
          writeFileSync(join(restoreStage, 'moved.txt'), 'recovery data\n');
          writeFileSync(target, 'after\n');
          throw new Error('injected lifecycle failure');
        }) as () => never),
      /injected lifecycle failure/,
    );

    assert.equal(readFileSync(target, 'utf8'), 'before\n');
    assert.equal(existsSync(restoreStage), false);
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
