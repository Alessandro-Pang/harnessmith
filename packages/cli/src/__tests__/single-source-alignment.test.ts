import assert from 'node:assert/strict';
import { test } from 'vitest';
import { digestBudgetDefaults as harnessDigestBudget } from '../../../harness/src/lib/filesystem/files.js';
import { gitRedirectVariables as harnessGitRedirect } from '../../../harness/src/lib/filesystem/git-environment.js';
import { lockStaleMilliseconds as harnessLockStale } from '../../../harness/src/lib/filesystem/lock-stale.js';
import { digestBudgetDefaults as cliDigestBudget } from '../shared/files.js';
import { gitRedirectVariables as cliGitRedirect } from '../shared/git-environment.js';
import { lockStaleMilliseconds as cliLockStale } from '../shared/lock-stale.js';

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
