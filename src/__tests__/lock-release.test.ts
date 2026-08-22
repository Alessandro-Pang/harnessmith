import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test, vi } from 'vitest';
import type { Adapter } from '../types.js';

const locks = vi.hoisted(() => ({ lockSync: vi.fn() }));

vi.mock('proper-lockfile', () => ({ default: { lockSync: locks.lockSync } }));

import { withExclusiveDirectoryLock } from '../../template/agent-harness/src/lib/exclusive-lock.js';
import { adapterCapabilities } from '../adapters.js';
import { withAdapterLocks } from '../operation-lock.js';

function adapter(home: string, name: Adapter['name']): Adapter {
  return {
    name,
    label: name,
    home,
    harness: join(home, 'agent-harness'),
    record: join(home, '.harnessmith', 'install.json'),
    capabilities: adapterCapabilities(name),
    instructions: [],
  };
}

test('adapter locks release every acquired lock and preserve the operation failure', () => {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-lock-release-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const released: string[] = [];
  locks.lockSync
    .mockReset()
    .mockReturnValueOnce(() => released.push('first'))
    .mockReturnValueOnce(() => {
      released.push('second');
      throw new Error('release failure');
    });
  const primary = new Error('operation failure');

  let caught: unknown;
  try {
    withAdapterLocks(
      [adapter(join(root, 'a'), 'codex'), adapter(join(root, 'b'), 'cursor')],
      () => {
        throw primary;
      },
    );
  } catch (error) {
    caught = error;
  }

  assert.ok(caught instanceof Error);
  assert.match(caught.message, /operation failure/);
  assert.match(caught.message, /release failure/);
  assert.equal(caught.cause, primary);
  assert.deepEqual(released, ['second', 'first']);
});

test('adapter locks sort, acquire, release, and return successful operations', () => {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-lock-success-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const released: string[] = [];
  locks.lockSync
    .mockReset()
    .mockReturnValueOnce(() => released.push('a'))
    .mockReturnValueOnce(() => released.push('b'));

  const result = withAdapterLocks(
    [adapter(join(root, 'b'), 'cursor'), adapter(join(root, 'a'), 'codex')],
    () => 'complete',
  );

  assert.equal(result, 'complete');
  assert.deepEqual(released, ['b', 'a']);
  assert.match(String(locks.lockSync.mock.calls[0][0]), /\/a$/);
});

test('adapter locks can inspect an absent home without creating or locking it', () => {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-lock-readonly-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, 'absent');
  locks.lockSync.mockReset();

  assert.equal(
    withAdapterLocks([adapter(home, 'codex')], () => 42, { createHomes: false }),
    42,
  );
  assert.equal(locks.lockSync.mock.calls.length, 0);
});

test('adapter lock acquisition failures use the stable operation-locked contract', () => {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-lock-acquire-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  locks.lockSync.mockReset().mockImplementationOnce(() => {
    throw new Error('busy');
  });

  assert.throws(
    () => withAdapterLocks([adapter(join(root, 'home'), 'codex')], () => 'never'),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'OPERATION_LOCKED' &&
      /operation lock/.test(error.message),
  );
});

test('adapter locks preserve a non-Error operation failure after successful release', () => {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-lock-primary-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  locks.lockSync.mockReset().mockReturnValueOnce(() => {});

  let caught: unknown;
  try {
    withAdapterLocks([adapter(join(root, 'home'), 'codex')], () => {
      throw 'primary scalar';
    });
  } catch (error) {
    caught = error;
  }
  assert.equal(caught, 'primary scalar');
});

test('adapter locks do not swallow a falsy thrown value', () => {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-lock-falsy-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  locks.lockSync.mockReset().mockReturnValueOnce(() => {});
  let completed = false;

  try {
    withAdapterLocks([adapter(join(root, 'home'), 'codex')], () => {
      throw undefined;
    });
    completed = true;
  } catch (error) {
    assert.equal(error, undefined);
  }

  assert.equal(completed, false);
});

test('adapter locks report a release-only failure and preserve Error cause', () => {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-lock-release-only-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const release = new Error('release only');
  locks.lockSync.mockReset().mockReturnValueOnce(() => {
    throw release;
  });

  let caught: unknown;
  try {
    withAdapterLocks([adapter(join(root, 'home'), 'codex')], () => 'complete');
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof Error);
  assert.match(caught.message, /Adapter lock release was incomplete/);
  assert.equal(caught.cause, release);
});

test('adapter locks report a non-Error release-only failure without a cause', () => {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-lock-release-scalar-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  locks.lockSync.mockReset().mockReturnValueOnce(() => {
    throw 'release scalar';
  });

  let caught: unknown;
  try {
    withAdapterLocks([adapter(join(root, 'home'), 'codex')], () => 'complete');
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof Error);
  assert.match(caught.message, /release scalar/);
  assert.equal(caught.cause, undefined);
});

test('adapter locks handle non-Error primary and release failures without synthetic cause', () => {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-lock-scalar-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  locks.lockSync.mockReset().mockReturnValueOnce(() => {
    throw 'release scalar';
  });

  let caught: unknown;
  try {
    withAdapterLocks([adapter(join(root, 'home'), 'codex')], () => {
      throw 'primary scalar';
    });
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof Error);
  assert.match(caught.message, /primary scalar.*release scalar/);
  assert.equal(caught.cause, undefined);
});

test('exclusive directory lock preserves the operation failure when release also fails', () => {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-exclusive-release-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(root, { recursive: true });
  locks.lockSync.mockReset().mockReturnValueOnce(() => {
    throw new Error('release failure');
  });
  const primary = new Error('operation failure');

  let caught: unknown;
  try {
    withExclusiveDirectoryLock(root, 'Memory', () => {
      throw primary;
    });
  } catch (error) {
    caught = error;
  }

  assert.ok(caught instanceof Error);
  assert.match(caught.message, /operation failure/);
  assert.match(caught.message, /release failure/);
  assert.equal(caught.cause, primary);
});
