import { homedir } from 'node:os';
import { join } from 'node:path';
import { canonicalPath } from '../shared/safe-path.js';
import type { Adapter, Hub, ManagedOutput } from '../shared/types.js';
import { HarnessmithError } from '../shared/types.js';

/** Skill directory name shared by every host; must match `SKILL.md` `name`. */
export const harnessSkillName = 'agent-harness';

export const hubDirectoryName = 'harnessmith';

function userHome(env: NodeJS.ProcessEnv): string {
  return canonicalPath(env.HOME || homedir());
}

/**
 * Resolve the shared hub. Hosts never receive a Harness copy: the rendered entry and
 * skill live once under `~/.agents/harnessmith` (`HARNESS_HOME` overrides the home; the
 * `~/.agents/skills/agent-harness` discovery link always stays in `~/.agents`).
 */
export function resolveHub(env: NodeJS.ProcessEnv = process.env): Hub {
  const home = userHome(env);
  const agentsHome = canonicalPath(join(home, '.agents'));
  const hubHome = canonicalPath(env.HARNESS_HOME || join(agentsHome, hubDirectoryName));
  const entry = join(hubHome, 'entry', 'AGENTS.md');
  const harness = join(hubHome, 'skills', harnessSkillName);
  const discoveryLink = join(agentsHome, 'skills', harnessSkillName);
  const outputs: ManagedOutput[] = [
    { path: harness, kind: 'tree' },
    { path: entry, kind: 'file' },
    { path: discoveryLink, kind: 'link', target: harness, root: agentsHome },
  ];
  return {
    scope: 'hub',
    name: 'hub',
    label: 'Harness hub',
    userHome: home,
    agentsHome,
    home: hubHome,
    record: join(hubHome, '.harnessmith', 'install.json'),
    outputs,
    entry,
    harness,
    discoveryLink,
    state: join(hubHome, 'state'),
    rules: canonicalPath(env.HARNESS_PERSONAL_HOME || join(hubHome, 'rules')),
    memory: canonicalPath(env.HARNESS_MEMORY_HOME || join(hubHome, 'memory')),
    legacyRules: join(home, '.agent-harness'),
    legacyMemory: join(home, '.agent-docs'),
  };
}

/**
 * Identity under which a host layer owns the hub. Global hosts own it once per agent;
 * project-scoped hosts (Cursor) own it once per project, so uninstalling one project never
 * releases the links other projects of the same host still depend on.
 */
export function hubOwnerId(adapter: Pick<Adapter, 'name' | 'project'>): string {
  return adapter.project ? `${adapter.name}:${adapter.project}` : adapter.name;
}

export function ownerAgentName(owner: string): string {
  return owner.split(':', 1)[0] ?? owner;
}

/** Every adapter in one operation must link into the same hub. */
export function sharedHub(adapters: Adapter[]): Hub {
  const [first, ...rest] = adapters;
  if (!first) throw new HarnessmithError('CLI_USAGE', 'No agent selected', 2);
  for (const adapter of rest) {
    if (adapter.hub.home !== first.hub.home) {
      throw new HarnessmithError(
        'SAFETY_CONFLICT',
        `Agents resolve different hubs: ${first.hub.home} and ${adapter.hub.home}`,
        3,
      );
    }
  }
  return first.hub;
}
