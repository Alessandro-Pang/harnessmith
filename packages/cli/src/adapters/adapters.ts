import { homedir } from 'node:os';
import { join } from 'node:path';
import { resolveHub } from '../installation/hub.js';
import { canonicalPath } from '../shared/safe-path.js';
import type { Adapter, AdapterCapabilities } from '../shared/types.js';
import { HarnessmithError } from '../shared/types.js';
import { type AgentName, getAdapterDefinition } from './adapter-registry.js';
import { resolveCursorAdapter } from './cursor-adapter.js';
import { type AdapterResolveContext, type AdapterResolver, hostAdapter } from './host-adapter.js';

export { harnessSkillName, resolveHub } from '../installation/hub.js';
export { inspectGit, resolveGitExecutable } from './git-inspection.js';

export function adapterCapabilities(name: AgentName): AdapterCapabilities {
  return getAdapterDefinition(name).capabilities;
}

/** Codex scans `~/.agents/skills` natively, so it only needs the shared entry link. */
function resolveCodexAdapter({ env, userHome, hub }: AdapterResolveContext): Adapter {
  const agentHome = canonicalPath(env.CODEX_HOME || join(userHome, '.codex'));
  return hostAdapter('codex', agentHome, hub);
}

/** Claude Code only scans `~/.claude/skills`, so it also gets a skill link. */
function resolveClaudeAdapter({ env, userHome, hub }: AdapterResolveContext): Adapter {
  const agentHome = canonicalPath(env.CLAUDE_CONFIG_DIR || join(userHome, '.claude'));
  return hostAdapter('claude', agentHome, hub, {
    instructionFiles: ['AGENTS.md', 'CLAUDE.md'],
    skillLink: true,
  });
}

function resolveOpenCodeAdapter({ env, userHome, hub }: AdapterResolveContext): Adapter {
  const configRoot = canonicalPath(env.XDG_CONFIG_HOME || join(userHome, '.config'));
  const agentHome = canonicalPath(env.OPENCODE_CONFIG_DIR || join(configRoot, 'opencode'));
  return hostAdapter('opencode', agentHome, hub);
}

function resolveKimiAdapter({ env, userHome, hub }: AdapterResolveContext): Adapter {
  const agentHome = canonicalPath(env.KIMI_CODE_HOME || join(userHome, '.kimi-code'));
  return hostAdapter('kimi', agentHome, hub);
}

export function resolveZedAgentHome(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
  userHome = canonicalPath(env.HOME || homedir()),
): string {
  if (platform === 'win32')
    return canonicalPath(join(env.APPDATA || join(userHome, 'AppData', 'Roaming'), 'Zed'));
  return canonicalPath(join(userHome, '.config', 'zed'));
}

function resolveZedAdapter({ env, userHome, hub }: AdapterResolveContext): Adapter {
  return hostAdapter('zed', resolveZedAgentHome(env, process.platform, userHome), hub);
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
  zed: resolveZedAdapter,
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
    hub: resolveHub(env),
  });
}
