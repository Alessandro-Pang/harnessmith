import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { execaSync } from 'execa';
import { whichCommandSync } from 'which-command';
import { canonicalPath } from './safe-path.js';
import type { Adapter, AdapterCapabilities, AgentName } from './types.js';
import { HarnessmithError } from './types.js';

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
    env: {
      GCM_INTERACTIVE: 'Never',
      GIT_TERMINAL_PROMPT: '0',
      LANG: 'C',
      LC_ALL: 'C',
      NODEFAULTCURRENTDIRECTORYINEXEPATH: '1',
    },
    maxBuffer: 20 * 1024 * 1024,
    reject: false,
    stdin: 'ignore',
    stripFinalNewline: false,
    timeout,
  });
  return result.failed ? gitFailure(result) : { ok: true, stdout: result.stdout };
}

function gitInspectionError(action: string, result: Exclude<GitInspection, { ok: true }>): never {
  throw new HarnessmithError('INTEGRITY_ERROR', `Unable to ${action}: ${result.message}`, 3);
}

export function adapterCapabilities(name: AgentName): AdapterCapabilities {
  const cursor = name === 'cursor';
  return {
    scope: cursor ? 'project' : 'global',
    instructionFormat: cursor ? 'mdc' : 'markdown',
    nativeRuleActivation: cursor ? 'always' : 'host-default',
    enforcement: {
      fileOwnership: 'harnessmith',
      instructions: 'advisory',
      permissions: 'host-owned',
    },
  };
}

function projectRoot(input: string): string {
  const requested = resolve(input);
  if (!existsSync(requested))
    throw new HarnessmithError('CLI_USAGE', `Project path does not exist: ${requested}`, 2);
  if (!statSync(requested).isDirectory())
    throw new HarnessmithError('CLI_USAGE', `Project path is not a directory: ${requested}`, 2);
  const inspection = inspectGit(requested, ['rev-parse', '--show-toplevel']);
  if (inspection.ok) return canonicalPath(inspection.stdout.trim());
  if (inspection.kind === 'not-repository') return canonicalPath(requested);
  return gitInspectionError('resolve the project Git root', inspection);
}

function plainInstructions(content: string): string {
  return `<!-- managed-by: harnessmith -->\n\n${content}`;
}

function mdcInstructions(content: string): string {
  return `---\ndescription: Personal coding agent harness\nglobs:\nalwaysApply: true\n---\n\n<!-- managed-by: harnessmith -->\n\n${content}`;
}

function gitExcludePath(root: string): string | null {
  const inspection = inspectGit(root, ['rev-parse', '--git-path', 'info/exclude']);
  if (inspection.ok) return resolve(root, inspection.stdout.trim());
  if (inspection.kind === 'not-repository') return null;
  return gitInspectionError('resolve the Git exclude path', inspection);
}

export function createAdapter(
  name: AgentName,
  {
    env = process.env,
    project = process.cwd(),
  }: { env?: NodeJS.ProcessEnv; project?: string } = {},
): Adapter {
  const home = canonicalPath(env.HOME || homedir());
  if (name === 'codex') {
    const agentHome = canonicalPath(env.CODEX_HOME || join(home, '.codex'));
    return {
      name,
      label: 'Codex',
      home: agentHome,
      harness: join(agentHome, 'agent-harness'),
      record: join(agentHome, '.harnessmith', 'install.json'),
      capabilities: adapterCapabilities(name),
      instructions: [{ path: join(agentHome, 'AGENTS.md'), render: plainInstructions }],
    };
  }
  if (name === 'claude') {
    const agentHome = canonicalPath(env.CLAUDE_CONFIG_DIR || join(home, '.claude'));
    return {
      name,
      label: 'Claude Code',
      home: agentHome,
      harness: join(agentHome, 'agent-harness'),
      record: join(agentHome, '.harnessmith', 'install.json'),
      capabilities: adapterCapabilities(name),
      instructions: [
        { path: join(agentHome, 'AGENTS.md'), render: plainInstructions },
        { path: join(agentHome, 'CLAUDE.md'), render: plainInstructions },
      ],
    };
  }
  if (name === 'cursor') {
    const root = projectRoot(project);
    const agentHome = join(root, '.cursor');
    const excludePath = gitExcludePath(root);
    return {
      name,
      label: 'Cursor',
      home: agentHome,
      project: root,
      harness: join(agentHome, 'agent-harness'),
      record: join(agentHome, '.harnessmith', 'install.json'),
      capabilities: adapterCapabilities(name),
      instructions: [
        { path: join(agentHome, 'AGENTS.md'), render: plainInstructions },
        { path: join(agentHome, 'rules', 'agent-harness.mdc'), render: mdcInstructions },
      ],
      localIgnoreFiles: [
        ...(excludePath
          ? [
              {
                path: excludePath,
                root: dirname(excludePath),
                preserveEmpty: true,
                lines: [
                  '/.cursor/agent-harness/',
                  '/.cursor/AGENTS.md',
                  '/.cursor/.harnessmith/',
                  '/.cursor/.harnessmith-stage-*',
                  '/.cursor/.harnessmith-restore-*',
                  '/.cursor/.harnessmith-operation.lock',
                  '/.cursor/.ignore',
                  '/.cursor/rules/agent-harness.mdc',
                  '/.cursor/*.backup-*',
                  '/.cursor/rules/agent-harness.mdc.backup-*',
                ],
              },
            ]
          : []),
        {
          path: join(agentHome, '.ignore'),
          lines: [
            '/agent-harness/',
            '/AGENTS.md',
            '/.harnessmith/',
            '/.harnessmith-stage-*',
            '/.harnessmith-restore-*',
            '/.harnessmith-operation.lock',
            '/rules/agent-harness.mdc',
            '/*.backup-*',
            '/rules/agent-harness.mdc.backup-*',
          ],
        },
      ],
    };
  }
  throw new HarnessmithError('CLI_USAGE', `Unsupported agent: ${name}`, 2);
}
