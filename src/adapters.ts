import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { type GitInspection, inspectGit } from './git-inspection.js';
import { canonicalPath, isPathInside } from './safe-path.js';
import type { Adapter, AdapterCapabilities, AgentName } from './types.js';
import { HarnessmithError } from './types.js';

export { inspectGit, resolveGitExecutable } from './git-inspection.js';

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
  const canonicalRequested = canonicalPath(requested);
  const inspection = inspectGit(canonicalRequested, ['rev-parse', '--show-toplevel']);
  if (inspection.ok) {
    const root = canonicalPath(inspection.stdout.trim());
    if (!isPathInside(root, canonicalRequested)) {
      throw new HarnessmithError(
        'INTEGRITY_ERROR',
        `Git root is outside the requested project boundary: ${root}`,
        3,
      );
    }
    return root;
  }
  if (inspection.kind === 'not-repository') return canonicalRequested;
  return gitInspectionError('resolve the project Git root', inspection);
}

function plainInstructions(content: string): string {
  return `<!-- managed-by: harnessmith -->\n\n${content}`;
}

function mdcInstructions(content: string): string {
  return `---\ndescription: Personal coding agent harness\nglobs:\nalwaysApply: true\n---\n\n<!-- managed-by: harnessmith -->\n\n${content}`;
}

function globalMarkdownAdapter(
  name: AgentName,
  label: string,
  home: string,
  instructionFiles: string[] = ['AGENTS.md'],
): Adapter {
  return {
    name,
    label,
    home,
    harness: join(home, 'agent-harness'),
    record: join(home, '.harnessmith', 'install.json'),
    capabilities: adapterCapabilities(name),
    instructions: instructionFiles.map((file) => ({
      path: join(home, file),
      render: plainInstructions,
    })),
  };
}

function gitExcludePath(root: string): { path: string; root: string } | null {
  const commonInspection = inspectGit(root, ['rev-parse', '--git-common-dir']);
  if (!commonInspection.ok) {
    if (commonInspection.kind === 'not-repository') return null;
    return gitInspectionError('resolve the Git common directory', commonInspection);
  }
  const commonRoot = canonicalPath(resolve(root, commonInspection.stdout.trim()));
  const pathInspection = inspectGit(root, ['rev-parse', '--git-path', 'info/exclude']);
  if (!pathInspection.ok) {
    if (pathInspection.kind === 'not-repository') return null;
    return gitInspectionError('resolve the Git exclude path', pathInspection);
  }
  const path = canonicalPath(resolve(root, pathInspection.stdout.trim()));
  const expected = canonicalPath(join(commonRoot, 'info', 'exclude'));
  if (!isPathInside(commonRoot, path) || path !== expected) {
    throw new HarnessmithError(
      'INTEGRITY_ERROR',
      `Git exclude path is outside the Git common directory: ${path}`,
      3,
    );
  }
  return { path, root: commonRoot };
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
    return globalMarkdownAdapter(name, 'Codex', agentHome);
  }
  if (name === 'claude') {
    const agentHome = canonicalPath(env.CLAUDE_CONFIG_DIR || join(home, '.claude'));
    return globalMarkdownAdapter(name, 'Claude Code', agentHome, ['AGENTS.md', 'CLAUDE.md']);
  }
  if (name === 'opencode') {
    const configRoot = canonicalPath(env.XDG_CONFIG_HOME || join(home, '.config'));
    const agentHome = canonicalPath(env.OPENCODE_CONFIG_DIR || join(configRoot, 'opencode'));
    return globalMarkdownAdapter(name, 'OpenCode', agentHome);
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
                path: excludePath.path,
                root: excludePath.root,
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
