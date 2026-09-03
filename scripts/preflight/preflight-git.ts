import { inspectGit } from '../../packages/cli/src/adapters/adapters.js';
import { validBranchName } from './branch-contract.js';

export { validBranchName };

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
  check(validBranchName(branch), `branch name does not match <type>/<issue>-<slug>: ${branch}`);
}
