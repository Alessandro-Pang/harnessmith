import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { type AgentName, getAdapterDefinition } from './adapter-registry.js';
import { type GitInspection, inspectGit } from './git-inspection.js';
import {
  instructionRenderer,
  renderMarkdownInstructions,
  renderMdcInstructions,
} from './instruction-formats.js';
import { normalizePiAgentDir } from './pi-paths.js';
import { canonicalPath, isPathInside } from './safe-path.js';
import type { Adapter, AdapterCapabilities } from './types.js';
import { HarnessmithError } from './types.js';

export { inspectGit, resolveGitExecutable } from './git-inspection.js';

interface AdapterResolveContext {
  env: NodeJS.ProcessEnv;
  project: string;
  userHome: string;
}

type AdapterResolver = (context: AdapterResolveContext) => Adapter;

function gitInspectionError(action: string, result: Exclude<GitInspection, { ok: true }>): never {
  throw new HarnessmithError('INTEGRITY_ERROR', `Unable to ${action}: ${result.message}`, 3);
}

export function adapterCapabilities(name: AgentName): AdapterCapabilities {
  return getAdapterDefinition(name).capabilities;
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

function globalMarkdownAdapter(
  name: AgentName,
  home: string,
  instructionFiles: string[] = ['AGENTS.md'],
): Adapter {
  const definition = getAdapterDefinition(name);
  const render = instructionRenderer(definition.capabilities.instructionFormat);
  return {
    name,
    label: definition.label,
    home,
    harness: join(home, 'agent-harness'),
    record: join(home, '.harnessmith', 'install.json'),
    capabilities: definition.capabilities,
    instructions: instructionFiles.map((file) => ({
      path: join(home, file),
      render,
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

function resolveCodexAdapter({ env, userHome }: AdapterResolveContext): Adapter {
  const agentHome = canonicalPath(env.CODEX_HOME || join(userHome, '.codex'));
  return globalMarkdownAdapter('codex', agentHome);
}

function resolveClaudeAdapter({ env, userHome }: AdapterResolveContext): Adapter {
  const agentHome = canonicalPath(env.CLAUDE_CONFIG_DIR || join(userHome, '.claude'));
  return globalMarkdownAdapter('claude', agentHome, ['AGENTS.md', 'CLAUDE.md']);
}

function resolveOpenCodeAdapter({ env, userHome }: AdapterResolveContext): Adapter {
  const configRoot = canonicalPath(env.XDG_CONFIG_HOME || join(userHome, '.config'));
  const agentHome = canonicalPath(env.OPENCODE_CONFIG_DIR || join(configRoot, 'opencode'));
  return globalMarkdownAdapter('opencode', agentHome);
}

function resolveKimiAdapter({ env, userHome }: AdapterResolveContext): Adapter {
  const agentHome = canonicalPath(env.KIMI_CODE_HOME || join(userHome, '.kimi-code'));
  return globalMarkdownAdapter('kimi', agentHome);
}

function resolveDeepSeekAdapter({ env, userHome }: AdapterResolveContext): Adapter {
  // Official DeepSeek Harness (dsh) home: $DSH_HOME, default ~/.dsh.
  // Empty/whitespace DSH_HOME is treated as unset (upstream resolveDshHome).
  // User-global instructions only: $DSH_HOME/AGENTS.md via @deepseek-ai/dsh-agent-instructions.
  const configured = env.DSH_HOME;
  const agentHome = canonicalPath(
    configured !== undefined && configured.trim().length > 0 ? configured : join(userHome, '.dsh'),
  );
  return globalMarkdownAdapter('deepseek', agentHome);
}

function resolvePiAdapter({ env, userHome }: AdapterResolveContext): Adapter {
  // Pi Coding Agent config root: $PI_CODING_AGENT_DIR, default ~/.pi/agent.
  // PI_CODING_AGENT_DIR has dual role (config root AND writable state dir for sessions/settings/auth).
  // Empty/whitespace PI_CODING_AGENT_DIR is treated as unset.
  // Normalize Pi's literal tilde and Windows shell path forms before SafePath canonicalization.
  const configured = env.PI_CODING_AGENT_DIR;
  const agentHome = canonicalPath(
    configured !== undefined && configured.trim().length > 0
      ? normalizePiAgentDir(configured, userHome)
      : join(userHome, '.pi', 'agent'),
  );
  return globalMarkdownAdapter('pi', agentHome);
}

function resolveWorkBuddyAdapter({ env, userHome }: AdapterResolveContext): Adapter {
  // Official CodeBuddy/WorkBuddy config root: $CODEBUDDY_CONFIG_DIR, default ~/.codebuddy.
  // Empty/whitespace CODEBUDDY_CONFIG_DIR is treated as unset.
  // User-global instructions only: CODEBUDDY.md (AGENTS.md is a host fallback when CODEBUDDY.md is absent).
  const configured = env.CODEBUDDY_CONFIG_DIR;
  const agentHome = canonicalPath(
    configured !== undefined && configured.trim().length > 0
      ? configured
      : join(userHome, '.codebuddy'),
  );
  return globalMarkdownAdapter('workbuddy', agentHome, ['CODEBUDDY.md']);
}

function resolveCursorAdapter({ project }: AdapterResolveContext): Adapter {
  const definition = getAdapterDefinition('cursor');
  const root = projectRoot(project);
  const agentHome = join(root, '.cursor');
  const excludePath = gitExcludePath(root);
  return {
    name: 'cursor',
    label: definition.label,
    home: agentHome,
    project: root,
    harness: join(agentHome, 'agent-harness'),
    record: join(agentHome, '.harnessmith', 'install.json'),
    capabilities: definition.capabilities,
    instructions: [
      { path: join(agentHome, 'AGENTS.md'), render: renderMarkdownInstructions },
      { path: join(agentHome, 'rules', 'agent-harness.mdc'), render: renderMdcInstructions },
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

/**
 * Exhaustive resolver map: adding a registry entry without a path resolver fails typecheck.
 * Host-specific paths and env vars remain here; the registry stays host-identity only.
 */
const adapterResolvers = {
  codex: resolveCodexAdapter,
  cursor: resolveCursorAdapter,
  claude: resolveClaudeAdapter,
  opencode: resolveOpenCodeAdapter,
  kimi: resolveKimiAdapter,
  deepseek: resolveDeepSeekAdapter,
  pi: resolvePiAdapter,
  workbuddy: resolveWorkBuddyAdapter,
} as const satisfies Record<AgentName, AdapterResolver>;

export function createAdapter(
  name: AgentName,
  {
    env = process.env,
    project = process.cwd(),
  }: { env?: NodeJS.ProcessEnv; project?: string } = {},
): Adapter {
  const resolver = adapterResolvers[name];
  if (!resolver) {
    throw new HarnessmithError('CLI_USAGE', `Unsupported agent: ${name}`, 2);
  }
  return resolver({
    env,
    project,
    userHome: canonicalPath(env.HOME || homedir()),
  });
}
