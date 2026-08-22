import { inspectGit } from '../src/adapters.js';

export function checkBranch(
  root: string,
  check: (condition: unknown, message: string) => void,
): void {
  const result = inspectGit(root, ['branch', '--show-current']);
  if (!result.ok) {
    check(false, `unable to inspect current Git branch: ${result.message}`);
    return;
  }
  const branch = result.stdout.trim();
  if (!branch || ['main', 'master', 'develop'].includes(branch)) return;
  check(
    /^(?:feature|hotfix|refactor)\/\d{8}_[a-z0-9]+(?:-[a-z0-9]+)*$/.test(branch),
    `branch name does not match (feature|hotfix|refactor)/YYYYMMDD_<feature-name>: ${branch}`,
  );
}
