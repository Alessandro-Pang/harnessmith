import type { AdapterCapabilities } from './types.js';

/**
 * Declarative Adapter Registry — single source of truth for host identity metadata.
 * Path resolution, env vars, and ignore rules stay in adapters.ts.
 * This is not a plugin loader: only built-in entries are registered.
 */

export const defaultAdapterEnforcement = {
  fileOwnership: 'harnessmith',
  instructions: 'advisory',
  permissions: 'host-owned',
} as const satisfies AdapterCapabilities['enforcement'];

export interface AdapterRegistryEntry {
  readonly name: string;
  readonly label: string;
  /** Extra CLI aliases beyond the positional 1-based index. */
  readonly aliases: readonly string[];
  readonly hint: string;
  readonly capabilities: AdapterCapabilities;
}

export const adapterRegistry = [
  {
    name: 'codex',
    label: 'Codex',
    aliases: [],
    hint: 'global configuration',
    capabilities: {
      scope: 'global',
      instructionFormat: 'markdown',
      nativeRuleActivation: 'host-default',
      enforcement: defaultAdapterEnforcement,
    },
  },
  {
    name: 'cursor',
    label: 'Cursor',
    aliases: [],
    hint: 'current project',
    capabilities: {
      scope: 'project',
      instructionFormat: 'mdc',
      nativeRuleActivation: 'always',
      enforcement: defaultAdapterEnforcement,
    },
  },
  {
    name: 'claude',
    label: 'Claude Code',
    aliases: ['claude-code'],
    hint: 'global configuration',
    capabilities: {
      scope: 'global',
      instructionFormat: 'markdown',
      nativeRuleActivation: 'host-default',
      enforcement: defaultAdapterEnforcement,
    },
  },
  {
    name: 'opencode',
    label: 'OpenCode',
    aliases: [],
    hint: 'global configuration',
    capabilities: {
      scope: 'global',
      instructionFormat: 'markdown',
      nativeRuleActivation: 'host-default',
      enforcement: defaultAdapterEnforcement,
    },
  },
  {
    name: 'kimi',
    label: 'Kimi Code CLI',
    aliases: ['kimi-code'],
    hint: 'global configuration',
    capabilities: {
      scope: 'global',
      instructionFormat: 'markdown',
      nativeRuleActivation: 'host-default',
      enforcement: defaultAdapterEnforcement,
    },
  },
  {
    name: 'deepseek',
    label: 'DeepSeek Harness',
    aliases: ['dsh', 'deepseek-harness'],
    hint: 'global configuration',
    capabilities: {
      scope: 'global',
      instructionFormat: 'markdown',
      nativeRuleActivation: 'host-default',
      enforcement: defaultAdapterEnforcement,
    },
  },
  {
    name: 'pi',
    label: 'Pi Agent',
    aliases: ['pi-agent'],
    hint: 'global configuration',
    capabilities: {
      scope: 'global',
      instructionFormat: 'markdown',
      nativeRuleActivation: 'host-default',
      enforcement: defaultAdapterEnforcement,
    },
  },
  {
    name: 'workbuddy',
    label: 'WorkBuddy',
    aliases: ['codebuddy', 'codebuddy-code'],
    hint: 'global configuration',
    capabilities: {
      scope: 'global',
      instructionFormat: 'markdown',
      nativeRuleActivation: 'host-default',
      enforcement: defaultAdapterEnforcement,
    },
  },
] as const satisfies readonly AdapterRegistryEntry[];

export type AgentName = (typeof adapterRegistry)[number]['name'];

export type AdapterDefinition = (typeof adapterRegistry)[number];

export const supportedAgentNames: readonly AgentName[] = adapterRegistry.map(({ name }) => name);

const definitionsByName = new Map<string, AdapterDefinition>(
  adapterRegistry.map((entry) => [entry.name, entry]),
);

export function getAdapterDefinition(name: AgentName): AdapterDefinition {
  const definition = definitionsByName.get(name);
  if (!definition) {
    throw new Error(`Unknown adapter registry entry: ${name}`);
  }
  return definition;
}

export function isRegisteredAgentName(value: unknown): value is AgentName {
  return typeof value === 'string' && definitionsByName.has(value);
}

/** Positional indices (1-based) plus declared aliases → canonical name. */
export function adapterAliasMap(): Map<string, AgentName> {
  const aliases = new Map<string, AgentName>();
  for (const [index, entry] of adapterRegistry.entries()) {
    aliases.set(String(index + 1), entry.name);
    for (const alias of entry.aliases) aliases.set(alias, entry.name);
  }
  return aliases;
}

/** Eval run.schema.json `host.adapter.enum` must match this list exactly. */
export function evalAdapterEnum(): AgentName[] {
  return [...supportedAgentNames];
}
