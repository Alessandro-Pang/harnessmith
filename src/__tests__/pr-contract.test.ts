import assert from 'node:assert/strict';
import { test } from 'vitest';
import { validatePullRequest } from '../../scripts/evaluation/contracts/pr-contract.js';

const validPullRequest = {
  title: 'feat(search): add indexed documentation search',
  body: `## Summary / 变更说明

Add a prebuilt search index.

## Related Issue / 关联 Issue

Closes #12

## Verification / 验证

pnpm run preflight

## Checklist / 检查清单

- [x] Reviewed
`,
  headRef: 'feat/12-indexed-doc-search',
};

test('accepts a conventional PR linked to the issue encoded in its branch', () => {
  assert.deepEqual(validatePullRequest(validPullRequest), []);
});

test('reports title, branch, issue-link, and template contract violations together', () => {
  const errors = validatePullRequest({
    title: 'Add search',
    body: 'Related to #99',
    headRef: 'search-improvements',
  });
  assert.ok(errors.some((error) => error.includes('title')));
  assert.ok(errors.some((error) => error.includes('branch')));
  assert.ok(errors.some((error) => error.includes('Closes #')));
  assert.ok(errors.some((error) => error.includes('Verification / 验证')));
});

test('requires the closing issue number to match the branch issue number', () => {
  const errors = validatePullRequest({
    ...validPullRequest,
    body: validPullRequest.body.replace('Closes #12', 'Fixes #13'),
  });
  assert.ok(errors.some((error) => error.includes('#12')));
});

test('allows Dependabot branches while retaining title and template checks', () => {
  assert.deepEqual(
    validatePullRequest({
      ...validPullRequest,
      title: 'chore(deps): update pnpm/action-setup',
      headRef: 'dependabot/github_actions/pnpm/action-setup-6',
    }),
    [],
  );
});
