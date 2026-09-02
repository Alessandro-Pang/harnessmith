import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { issueNumberFromBranch } from '../../preflight/branch-contract.js';

export interface PullRequestContractInput {
  title: string;
  body: string;
  headRef: string;
}

const titlePattern =
  /^(?:feat|fix|docs|refactor|perf|test|build|ci|chore|revert)(?:\([a-z0-9-]+\))?!?: .+/;
const closingIssuePattern = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)\b/i;
const requiredHeadings = [
  'Summary / 变更说明',
  'Related Issue / 关联 Issue',
  'Verification / 验证',
  'Checklist / 检查清单',
] as const;

export function validatePullRequest(input: PullRequestContractInput): string[] {
  const errors: string[] = [];
  if (!titlePattern.test(input.title.trim())) {
    errors.push('PR title must use Conventional Commit form, for example: feat(search): add index');
  }

  const branch = input.headRef.trim();
  const dependabot = branch.startsWith('dependabot/');
  const branchIssue = issueNumberFromBranch(branch);
  if (!dependabot && !branchIssue) {
    errors.push('PR branch must use <type>/<issue>-<slug>, for example: feat/12-indexed-search');
  }

  const closingIssue = input.body.match(closingIssuePattern)?.[1];
  if (!closingIssue) {
    errors.push('PR body must close its issue with Closes #<number> (or Fixes/Resolves)');
  } else if (branchIssue && closingIssue !== branchIssue) {
    errors.push(`PR body must close branch issue #${branchIssue}`);
  }

  for (const heading of requiredHeadings) {
    if (!new RegExp(`^## ${heading}$`, 'm').test(input.body)) {
      errors.push(`PR body is missing template heading: ${heading}`);
    }
  }
  return errors;
}

interface PullRequestEvent {
  pull_request?: {
    title?: unknown;
    body?: unknown;
    head?: { ref?: unknown };
  };
}

function eventInput(path: string): PullRequestContractInput {
  const event = JSON.parse(readFileSync(path, 'utf8')) as PullRequestEvent;
  const pullRequest = event.pull_request;
  if (!pullRequest) throw new Error('GITHUB_EVENT_PATH does not contain a pull_request payload');
  return {
    title: typeof pullRequest.title === 'string' ? pullRequest.title : '',
    body: typeof pullRequest.body === 'string' ? pullRequest.body : '',
    headRef: typeof pullRequest.head?.ref === 'string' ? pullRequest.head.ref : '',
  };
}

function main(): void {
  const path = process.env.GITHUB_EVENT_PATH;
  if (!path) throw new Error('GITHUB_EVENT_PATH is required');
  const errors = validatePullRequest(eventInput(path));
  if (errors.length === 0) {
    console.log('PR contract passed');
    return;
  }
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
}

const entry = process.argv[1] ? resolve(process.argv[1]) : '';
if (entry === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
