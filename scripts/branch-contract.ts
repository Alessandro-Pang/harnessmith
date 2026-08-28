const issueBranchPattern =
  /^(?:feat|fix|docs|refactor|perf|test|build|ci|chore|revert)\/(\d+)-[a-z0-9][a-z0-9-]*$/;

export function issueNumberFromBranch(branch: string): string | undefined {
  return branch.match(issueBranchPattern)?.[1];
}

export function validBranchName(branch: string): boolean {
  return (
    branch === '' ||
    ['main', 'master', 'develop'].includes(branch) ||
    branch.startsWith('dependabot/') ||
    issueNumberFromBranch(branch) !== undefined
  );
}
