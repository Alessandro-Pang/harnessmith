import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { checkBranch } from '../../scripts/preflight-git.js';
import { createAdapter, resolveGitExecutable } from '../adapters.js';

function withPath<T>(path: string, operation: () => T): T {
  const original = process.env.PATH;
  const originalPathExt = process.env.PATHEXT;
  process.env.PATH = path;
  if (process.platform === 'win32') {
    process.env.PATHEXT = ['.COM', '.EXE', '.BAT', '.CMD', originalPathExt || ''].join(delimiter);
  }
  try {
    return operation();
  } finally {
    if (original === undefined) delete process.env.PATH;
    else process.env.PATH = original;
    if (originalPathExt === undefined) delete process.env.PATHEXT;
    else process.env.PATHEXT = originalPathExt;
  }
}

function gitExecutable(bin: string, source: string, mode = 0o755): void {
  const path = join(bin, process.platform === 'win32' ? 'git.cmd' : 'git');
  if (process.platform === 'win32') {
    const script = join(bin, 'git.mjs');
    writeFileSync(script, `${source}\n`);
    writeFileSync(path, `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`);
  } else {
    writeFileSync(path, `#!${process.execPath}\n${source}\n`);
  }
  chmodSync(path, mode);
}

function executable(root: string, source: string, mode = 0o755): string {
  const bin = join(root, 'bin');
  mkdirSync(bin, { recursive: true });
  gitExecutable(bin, source, mode);
  return bin;
}

test('Windows Git resolution uses a trusted resolver cwd instead of the project cwd', () => {
  const resolved = resolveGitExecutable('win32', (command, options) => {
    assert.equal(command, 'git');
    assert.equal(options.cwd, dirname(process.execPath));
    return String.raw`C:\Program Files\Git\cmd\git.exe`;
  });

  assert.equal(resolved, String.raw`C:\Program Files\Git\cmd\git.exe`);
});

test('Cursor adapter falls back only when Git reports a non-repository', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-adapter-not-repository-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const bin = executable(
    root,
    "process.stderr.write('fatal: not a git repository\\n');\nprocess.exit(128);",
  );

  const adapter = withPath(`${bin}${delimiter}${process.env.PATH || ''}`, () =>
    createAdapter('cursor', { env: { HOME: root }, project: root }),
  );

  assert.equal(adapter.project, realpathSync.native(root));
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

test('Cursor adapter does not confuse Git stderr with a command resolver failure', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-adapter-git-windows-unavailable-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const bin = executable(
    root,
    `process.stderr.write("'git' is not recognized as an internal or external command,\\noperable program or batch file.\\n");
process.exit(1);`,
  );

  assert.throws(
    () => withPath(bin, () => createAdapter('cursor', { env: { HOME: root }, project: root })),
    /Git command failed/i,
  );
});

test.runIf(process.platform === 'win32')(
  'Cursor adapter does not execute a project-local Git command shim',
  () => {
    const root = mkdtempSync(join(tmpdir(), 'harness-adapter-git-cwd-'));
    onTestFinished(() => rmSync(root, { recursive: true, force: true }));
    const marker = join(root, 'git-command-hijacked');
    gitExecutable(
      root,
      `import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(marker)}, 'called\\n');
process.stderr.write('fatal: not a git repository\\n');
process.exit(128);`,
    );

    const adapter = createAdapter('cursor', { env: { HOME: root }, project: root });

    assert.equal(adapter.project, realpathSync.native(root));
    assert.equal(existsSync(marker), false);
  },
);

test.skipIf(process.platform === 'win32')(
  'Cursor adapter fails closed when Git cannot be executed',
  () => {
    const root = mkdtempSync(join(tmpdir(), 'harness-adapter-git-permission-'));
    onTestFinished(() => rmSync(root, { recursive: true, force: true }));
    const bin = executable(root, 'process.exit(0);', 0o644);

    assert.throws(
      () => withPath(bin, () => createAdapter('cursor', { env: { HOME: root }, project: root })),
      /Git executable permission denied/i,
    );
  },
);

test('Cursor adapter fails closed when Git reports permission denial', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-adapter-git-permission-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const bin = executable(
    root,
    "process.stderr.write('fatal: permission denied\\n');\nprocess.exit(128);",
  );

  assert.throws(
    () => withPath(bin, () => createAdapter('cursor', { env: { HOME: root }, project: root })),
    /Git permission denied/i,
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
