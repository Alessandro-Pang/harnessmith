import {
  canonicalJson,
  createMarkdownFileFinder,
  digest,
  memoryDoc,
  pathWithin,
  safeReadFile,
  treeChangedPaths,
  treeSnapshot,
} from './runtime-files.mjs';
import { createProcessRuntime } from './runtime-process.mjs';

/**
 * @param {unknown} value
 * @returns {import('../support/types.mjs').MemoryPayloadOutput | null}
 */
export function exactJsonObject(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** @param {{ repo: string, repository: string, candidate: string, packageRoot: string, evaluatorErrors: string[] }} context */
export function createScenarioRuntime(context) {
  const { repo, evaluatorErrors } = context;
  const processRuntime = createProcessRuntime(context);
  const { run, checked } = processRuntime;
  const markdownFiles = createMarkdownFileFinder(evaluatorErrors);

  /** @param {string[]} args @param {string} [cwd] */
  function git(args, cwd = repo) {
    return checked('git', args, { cwd });
  }

  /** @param {string} [cwd] */
  function gitCommit(cwd = repo) {
    git(['add', '-A'], cwd);
    const staged = run('git', ['diff', '--cached', '--quiet'], { cwd });
    if (staged.status === 1) {
      checked(
        'git',
        [
          '-c',
          'user.name=Harness-Eval',
          '-c',
          'user.email=eval@example.invalid',
          'commit',
          '-m',
          'test: evaluation setup',
        ],
        { cwd },
      );
    }
  }

  return {
    ...processRuntime,
    digest,
    safeReadFile,
    treeSnapshot,
    treeChangedPaths,
    pathWithin,
    markdownFiles,
    canonicalJson,
    exactJsonObject,
    git,
    gitCommit,
    memoryDoc,
  };
}
