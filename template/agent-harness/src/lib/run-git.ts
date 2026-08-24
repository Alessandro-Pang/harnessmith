import { dirname } from 'node:path';
import { execaSync } from 'execa';
import { whichCommandSync } from 'which-command';

export const DEFAULT_GIT_TIMEOUT_MS = 5_000;
const GIT_MAX_BUFFER = 20 * 1024 * 1024;

/** @public */
export type GitFailureKind = 'not-repository' | 'unavailable' | 'timeout' | 'permission' | 'failed';

/** @public */
export interface GitFailureResult {
  code?: string;
  exitCode?: number;
  failed: boolean;
  isMaxBuffer: boolean;
  shortMessage?: string;
  stderr?: string | Uint8Array;
  timedOut: boolean;
}

/** @public */
export class GitCommandError extends Error {
  readonly kind: Exclude<GitFailureKind, 'not-repository'>;

  constructor(kind: Exclude<GitFailureKind, 'not-repository'>, message: string) {
    super(message);
    this.name = 'GitCommandError';
    this.kind = kind;
  }
}

export interface RunGitOptions {
  deadline?: number;
  timeoutMs?: number;
}

export type GitRunResult =
  | { ok: true; stdout: Buffer }
  | { ok: false; kind: 'not-repository'; stderr: Buffer }
  | {
      ok: false;
      kind: Exclude<GitFailureKind, 'not-repository'>;
      stderr: Buffer;
      error: GitCommandError;
    };

function outputBuffer(value: string | Uint8Array | undefined): Buffer {
  return Buffer.from(value || []);
}

function outputText(value: string | Uint8Array | undefined): string {
  return typeof value === 'string' ? value : outputBuffer(value).toString('utf8');
}

/** @public */
export function classifyGitFailure(result: GitFailureResult): GitFailureKind {
  const details = outputText(result.stderr);
  if (result.timedOut) return 'timeout';
  if (result.code === 'ENOENT') return 'unavailable';
  if (
    result.code === 'EACCES' ||
    result.code === 'EPERM' ||
    /permission denied|dubious ownership|unsafe repository/i.test(details)
  ) {
    return 'permission';
  }
  return /not a git repository/i.test(details) ? 'not-repository' : 'failed';
}

/** @public */
export function gitCommandError(
  result: GitFailureResult,
  kind: Exclude<GitFailureKind, 'not-repository'>,
): GitCommandError {
  const details = outputText(result.stderr).trim() || result.shortMessage || 'unknown Git failure';
  if (kind === 'timeout') return new GitCommandError(kind, 'Git command timed out');
  if (kind === 'unavailable') return new GitCommandError(kind, 'Git executable is unavailable');
  if (kind === 'permission') {
    if (result.code === 'EACCES' || result.code === 'EPERM') {
      return new GitCommandError(kind, `Git executable permission denied: ${details}`);
    }
    const message = /dubious ownership|unsafe repository/i.test(details)
      ? `Git repository ownership check failed: ${details}`
      : `Git permission denied: ${details}`;
    return new GitCommandError(kind, message);
  }
  const message = result.isMaxBuffer
    ? 'Git command output exceeded its buffer limit'
    : `Git command failed: ${details}`;
  return new GitCommandError('failed', message);
}

function gitTimeout({ deadline, timeoutMs = DEFAULT_GIT_TIMEOUT_MS }: RunGitOptions): number {
  return deadline === undefined ? timeoutMs : deadline - Date.now();
}

function failedRun(result: GitFailureResult): Exclude<GitRunResult, { ok: true }> {
  const kind = classifyGitFailure(result);
  const stderr = outputBuffer(result.stderr);
  if (kind === 'not-repository') return { ok: false, kind, stderr };
  return { ok: false, kind, stderr, error: gitCommandError(result, kind) };
}

type GitExecutableResolver = (command: string, options: { cwd: string }) => string | undefined;

function gitEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of [
    'GIT_ALTERNATE_OBJECT_DIRECTORIES',
    'GIT_CEILING_DIRECTORIES',
    'GIT_COMMON_DIR',
    'GIT_DIR',
    'GIT_DISCOVERY_ACROSS_FILESYSTEM',
    'GIT_INDEX_FILE',
    'GIT_OBJECT_DIRECTORY',
    'GIT_WORK_TREE',
  ]) {
    delete env[key];
  }
  return {
    ...env,
    GCM_INTERACTIVE: 'Never',
    GIT_TERMINAL_PROMPT: '0',
    LANG: 'C',
    LC_ALL: 'C',
    NODEFAULTCURRENTDIRECTORYINEXEPATH: '1',
  };
}

/** @public */
export function resolveGitExecutable(
  platform: NodeJS.Platform,
  resolver: GitExecutableResolver = whichCommandSync,
): string | undefined {
  if (platform !== 'win32') return 'git';
  return resolver('git', { cwd: dirname(process.execPath) });
}

export function runGit(args: string[], options: RunGitOptions = {}): GitRunResult {
  const timeout = gitTimeout(options);
  if (timeout < 1) {
    return failedRun({
      failed: true,
      isMaxBuffer: false,
      shortMessage: 'shared Git deadline exhausted',
      timedOut: true,
    });
  }
  const executable = resolveGitExecutable(process.platform);
  if (!executable) {
    return failedRun({
      code: 'ENOENT',
      failed: true,
      isMaxBuffer: false,
      timedOut: false,
    });
  }
  const result = execaSync(executable, args, {
    encoding: 'buffer',
    env: gitEnvironment(),
    extendEnv: false,
    maxBuffer: GIT_MAX_BUFFER,
    reject: false,
    stdin: 'ignore',
    stripFinalNewline: false,
    timeout,
  });
  if (!result.failed) return { ok: true, stdout: outputBuffer(result.stdout) };
  const timedOut =
    result.timedOut || (options.deadline !== undefined && Date.now() >= options.deadline);
  return failedRun({ ...result, timedOut });
}
