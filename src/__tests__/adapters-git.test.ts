import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { checkBranch } from '../../scripts/preflight-git.js';
import { createAdapter } from '../adapters.js';

function withPath<T>(path: string, operation: () => T): T {
  const original = process.env.PATH;
  process.env.PATH = path;
  try {
    return operation();
  } finally {
    if (original === undefined) delete process.env.PATH;
    else process.env.PATH = original;
  }
}

function executable(root: string, body: string, mode = 0o755): string {
  const bin = join(root, 'bin');
  mkdirSync(bin, { recursive: true });
  const path = join(bin, 'git');
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, mode);
  return bin;
}

test('Cursor adapter falls back only when Git reports a non-repository', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-adapter-not-repository-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const bin = executable(root, "echo 'fatal: not a git repository' >&2\nexit 128");

  const adapter = withPath(`${bin}${delimiter}${process.env.PATH || ''}`, () =>
    createAdapter('cursor', { env: { HOME: root }, project: root }),
  );

  assert.equal(adapter.project, realpathSync(root));
});

test('Cursor adapter fails closed when Git is unavailable', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-adapter-git-unavailable-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const emptyPath = join(root, 'empty-path');
  mkdirSync(emptyPath);

  assert.throws(
    () =>
      withPath(emptyPath, () => createAdapter('cursor', { env: { HOME: root }, project: root })),
    /Git executable is unavailable/i,
  );
});

test('Cursor adapter fails closed when Git cannot be executed', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-adapter-git-permission-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const bin = executable(root, 'exit 0', 0o644);

  assert.throws(
    () => withPath(bin, () => createAdapter('cursor', { env: { HOME: root }, project: root })),
    /Git executable permission denied/i,
  );
});

test('branch preflight reports Git unavailability without treating it as a branch name', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-preflight-git-unavailable-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const emptyPath = join(root, 'empty-path');
  mkdirSync(emptyPath);
  const checks: Array<{ condition: boolean; message: string }> = [];

  withPath(emptyPath, () =>
    checkBranch(root, (condition, message) => {
      checks.push({ condition: Boolean(condition), message });
    }),
  );

  assert.equal(checks.length, 1);
  assert.equal(checks[0].condition, false);
  assert.match(checks[0].message, /Git executable is unavailable/i);
});
