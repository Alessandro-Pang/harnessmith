import { existsSync } from 'node:fs';
import { runGit } from './run-git.js';

/** @public */
export {
  classifyGitFailure,
  GitCommandError,
  type GitFailureKind,
  type GitFailureResult,
  gitCommandError,
} from './run-git.js';

export function gitRoot(path: string): string | null {
  if (!existsSync(path)) return null;
  const result = runGit(['-C', path, 'rev-parse', '--show-toplevel']);
  if (result.ok) return result.stdout.toString('utf8').trim();
  if (result.kind === 'not-repository') return null;
  throw result.error;
}

export function gitVersion(): string | null {
  const result = runGit(['--version']);
  return result.ok ? result.stdout.toString('utf8').trim() : null;
}
