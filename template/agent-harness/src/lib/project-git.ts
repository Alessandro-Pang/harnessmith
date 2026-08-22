import { statSync } from 'node:fs';
import { dirname } from 'node:path';
import { DEFAULT_GIT_TIMEOUT_MS, runGit } from './run-git.js';

export interface ProjectSnapshotOptions {
  gitTimeoutMs?: number;
}

export interface ProjectGitBudget {
  deadline: number;
  exhausted: boolean;
}

export function createProjectGitBudget(options: ProjectSnapshotOptions): ProjectGitBudget {
  const timeout = options.gitTimeoutMs ?? DEFAULT_GIT_TIMEOUT_MS;
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 30_000)
    throw new Error(`Invalid Git timeout: ${timeout}`);
  return { deadline: Date.now() + timeout, exhausted: false };
}

export function projectGitRaw(
  path: string,
  args: string[],
  budget: ProjectGitBudget,
): Buffer | null {
  const result = runGit(
    [
      '-c',
      'core.fsmonitor=false',
      '-c',
      'core.untrackedCache=false',
      '-C',
      statSync(path).isDirectory() ? path : dirname(path),
      ...args,
    ],
    { deadline: budget.deadline },
  );
  if (result.ok) return result.stdout;
  if (result.kind === 'timeout') {
    budget.exhausted = true;
    throw result.error;
  }
  if (result.kind === 'not-repository') return null;
  const details = result.stderr.toString('utf8');
  if (
    result.kind === 'failed' &&
    args[0] === 'rev-parse' &&
    args.includes('HEAD') &&
    /ambiguous argument|unknown revision|needed a single revision/i.test(details)
  ) {
    return null;
  }
  throw result.error;
}

export function projectGit(path: string, args: string[], budget: ProjectGitBudget): string | null {
  return projectGitRaw(path, args, budget)?.toString('utf8').trim() ?? null;
}
