/** Mechanical source of truth for new branch names; documentation must cite it, never restate it. */
export const issueBranchPattern =
  /^(?:feat|fix|docs|refactor|perf|test|build|ci|chore|revert)\/(\d+)-[a-z0-9][a-z0-9-]*$/;

export const longLivedBranches = ['main', 'master', 'develop'] as const;

export const automatedBranchPrefix = 'dependabot/';

export function issueNumberFromBranch(branch: string): string | undefined {
  return branch.match(issueBranchPattern)?.[1];
}

export function validBranchName(branch: string): boolean {
  const issueLinked = issueNumberFromBranch(branch) !== undefined;
  const longLived = (longLivedBranches as readonly string[]).includes(branch);
  const automated = branch.startsWith(automatedBranchPrefix);
  return branch === '' || longLived || automated || issueLinked;
}
