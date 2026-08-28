import assert from 'node:assert/strict';
import { test } from 'vitest';
import { validBranchName } from '../../scripts/preflight-git.js';

test('accepts issue-linked branches and long-lived branches', () => {
  for (const branch of ['main', 'develop', 'feat/12-indexed-search', 'fix/15-clean-temp-files']) {
    assert.equal(validBranchName(branch), true, branch);
  }
});

test('rejects branches that omit the issue number or use unsafe slugs', () => {
  for (const branch of ['feature/20260828_search', 'feat/indexed-search', 'fix/12_Bad']) {
    assert.equal(validBranchName(branch), false, branch);
  }
});
