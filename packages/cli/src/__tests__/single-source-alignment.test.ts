import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import {
  digestBudgetDefaults as harnessDigestBudget,
  digestPath as harnessDigestPath,
} from '../../../harness/src/lib/filesystem/files.js';
import {
  gitRedirectVariables as harnessGitRedirect,
  sanitizeGitEnvironment as harnessSanitizeGitEnvironment,
} from '../../../harness/src/lib/filesystem/git-environment.js';
import { lockStaleMilliseconds as harnessLockStale } from '../../../harness/src/lib/filesystem/lock-stale.js';
import { resolveGitExecutable as harnessResolveGitExecutable } from '../../../harness/src/lib/filesystem/run-git.js';
import { userDataCoordinationTargets as harnessCoordinationTargets } from '../../../harness/src/lib/filesystem/user-data-lock.js';
import { resolveGitExecutable as cliResolveGitExecutable } from '../adapters/git-inspection.js';
import { userDataCoordinationTargets as cliCoordinationTargets } from '../installation/user-data-lock.js';
import {
  digestBudgetDefaults as cliDigestBudget,
  digestPath as cliDigestPath,
} from '../shared/files.js';
import {
  gitRedirectVariables as cliGitRedirect,
  sanitizeGitEnvironment as cliSanitizeGitEnvironment,
} from '../shared/git-environment.js';
import { lockStaleMilliseconds as cliLockStale } from '../shared/lock-stale.js';

function fixture(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test('installation and runtime share the same lock stale window', () => {
  assert.equal(cliLockStale, 15 * 60_000);
  assert.equal(harnessLockStale, cliLockStale);
});

test('digest path budgets stay aligned across the CLI and harness copies', () => {
  assert.deepEqual(cliDigestBudget, harnessDigestBudget);
  assert.equal(cliDigestBudget.maxBytes, 512 * 1024 * 1024);
});

test('Git redirection variables stay pinned to the shared hygiene list', () => {
  assert.deepEqual([...cliGitRedirect], [...harnessGitRedirect]);
  assert.ok(cliGitRedirect.includes('GIT_DIR'));
  assert.ok(cliGitRedirect.includes('GIT_WORK_TREE'));
});

test('user-data coordination targets derive the same key and root from the same input, including aliases', () => {
  const root = fixture('harnessmith-alignment-coordination-');
  const real = join(root, 'real');
  mkdirSync(real, { recursive: true });
  const alias = join(root, 'alias');
  symlinkSync(real, alias, 'dir');
  const notYetCreated = join(root, 'future', 'nested');
  const inputs = [real, alias, notYetCreated];

  const cli = cliCoordinationTargets(inputs);
  const harness = harnessCoordinationTargets(inputs);

  // Same input must yield the same canonical root + key in both copies; the symlink alias
  // canonicalizes onto the real root and is deduplicated, not treated as a second lock.
  assert.deepEqual(
    cli.map(({ root: r, key }) => ({ root: r, key })),
    harness.map(({ root: r, key }) => ({ root: r, key })),
  );
  assert.equal(cli.length, 2, 'alias and real root collapse to one coordination target');
  assert.ok(cli.every(({ key }) => /^[0-9a-f]{64}$/.test(key)));
  assert.deepEqual(
    cli.map(({ target }) => target),
    harness.map(({ target }) => target),
  );
});

test('Git environment sanitization eliminates dangerous redirection identically in both copies', () => {
  const polluted: NodeJS.ProcessEnv = {
    PATH: '/usr/bin',
    HOME: '/home/user',
    KEEP_ME: 'preserved',
  };
  for (const key of cliGitRedirect) polluted[key] = '/evil/redirect';

  const cli = cliSanitizeGitEnvironment(polluted);
  const harness = harnessSanitizeGitEnvironment(polluted);

  assert.deepEqual(cli, harness);
  for (const key of cliGitRedirect) {
    assert.equal(cli[key], undefined, `dangerous variable ${key} must be removed`);
  }
  assert.equal(cli.KEEP_ME, 'preserved');
  assert.equal(cli.PATH, '/usr/bin');
  assert.equal(cli.GIT_TERMINAL_PROMPT, '0');
  assert.equal(cli.LC_ALL, 'C');
  assert.equal(cli.GCM_INTERACTIVE, 'Never');
});

test('digest copies agree on a dangling symlink inside a scoped directory', () => {
  const root = fixture('harnessmith-alignment-digest-');
  const scope = join(root, 'scope');
  mkdirSync(scope, { recursive: true });
  symlinkSync('missing-target', join(scope, 'dangling'));

  const cli = cliDigestPath(scope);
  const harness = harnessDigestPath(scope);

  // Both copies must encode the dangling symlink as a symlink entry (never follow or drop
  // it), so a scoped tree digests identically. Root-level option differences stay documented
  // and are not force-unified here.
  assert.ok(cli, 'dangling symlink child must still produce a digest');
  assert.equal(cli, harness);

  const empty = join(root, 'empty');
  mkdirSync(empty, { recursive: true });
  assert.notEqual(cli, cliDigestPath(empty), 'the dangling symlink must contribute to the digest');
});

test('Git executable resolution stays aligned across CLI and runtime copies', () => {
  const executable = join('mock', 'git.exe');
  for (const platform of ['win32', 'linux', 'darwin'] as const) {
    const cli = cliResolveGitExecutable(platform, () => executable);
    const harness = harnessResolveGitExecutable(platform, () => executable);
    assert.equal(cli, harness);
    assert.equal(cli, platform === 'win32' ? executable : 'git');
  }
});
