const issueBranchPattern =
  /^(?:feat|fix|docs|refactor|perf|test|build|ci|chore|revert)\/(\d+)-[a-z0-9][a-z0-9-]*$/;

export function issueNumberFromBranch(branch: string): string | undefined {
  return branch.match(issueBranchPattern)?.[1];
}

export function validBranchName(branch: string): boolean {
  const issueLinked = issueNumberFromBranch(branch) !== undefined;
  const longLived = ['main', 'master', 'develop'].includes(branch);
  const automated = branch.startsWith('dependabot/');
  return branch === '' || longLived || automated || issueLinked;
}
