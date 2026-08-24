import { dirname } from 'node:path';
import { execaSync } from 'execa';
import { whichCommandSync } from 'which-command';

type GitFailureKind = 'not-repository' | 'unavailable' | 'timeout' | 'permission' | 'failed';

export type GitInspection =
  | { ok: true; stdout: string }
  | { ok: false; kind: GitFailureKind; message: string };

interface GitFailureResult {
  code?: string;
  exitCode?: number;
  failed: boolean;
  isMaxBuffer: boolean;
  shortMessage?: string;
  stderr?: string | Uint8Array;
  timedOut: boolean;
}

function outputText(value: string | Uint8Array | undefined): string {
  return typeof value === 'string' ? value : Buffer.from(value || []).toString('utf8');
}

function gitFailure(result: GitFailureResult): Exclude<GitInspection, { ok: true }> {
  const details = outputText(result.stderr).trim() || result.shortMessage || 'unknown Git failure';
  if (result.timedOut) return { ok: false, kind: 'timeout', message: 'Git command timed out' };
  if (result.code === 'ENOENT') {
    return { ok: false, kind: 'unavailable', message: 'Git executable is unavailable' };
  }
  if (result.code === 'EACCES' || result.code === 'EPERM') {
    return {
      ok: false,
      kind: 'permission',
      message: `Git executable permission denied: ${details}`,
    };
  }
  if (/permission denied/i.test(details)) {
    return { ok: false, kind: 'permission', message: `Git permission denied: ${details}` };
  }
  if (/dubious ownership|unsafe repository/i.test(details)) {
    return {
      ok: false,
      kind: 'permission',
      message: `Git repository ownership check failed: ${details}`,
    };
  }
  if (/not a git repository/i.test(details)) {
    return { ok: false, kind: 'not-repository', message: details };
  }
  if (result.isMaxBuffer) {
    return { ok: false, kind: 'failed', message: 'Git command output exceeded its buffer limit' };
  }
  return { ok: false, kind: 'failed', message: `Git command failed: ${details}` };
}

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

type GitExecutableResolver = (command: string, options: { cwd: string }) => string | undefined;

export function resolveGitExecutable(
  platform: NodeJS.Platform,
  resolver: GitExecutableResolver = whichCommandSync,
): string | undefined {
  if (platform !== 'win32') return 'git';
  return resolver('git', { cwd: dirname(process.execPath) });
}

export function inspectGit(root: string, args: string[], timeout = 5_000): GitInspection {
  const executable = resolveGitExecutable(process.platform);
  if (!executable) {
    return { ok: false, kind: 'unavailable', message: 'Git executable is unavailable' };
  }
  const result = execaSync(executable, args, {
    cwd: root,
    encoding: 'utf8',
    env: gitEnvironment(),
    extendEnv: false,
    maxBuffer: 20 * 1024 * 1024,
    reject: false,
    stdin: 'ignore',
    stripFinalNewline: false,
    timeout,
  });
  return result.failed ? gitFailure(result) : { ok: true, stdout: result.stdout };
}
