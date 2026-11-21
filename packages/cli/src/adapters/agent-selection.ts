import type { AgentName } from '../shared/scope-types.js';
import { HarnessmithError } from '../shared/types.js';
import {
  adapterAliasMap,
  adapterRegistry,
  isRegisteredAgentName,
  supportedAgentNames,
} from './adapter-registry.js';

/** Registry-derived selection options for the interactive agent picker and `all` expansion. */
export const supportedAgents = adapterRegistry.map(({ name, label, hint }) => ({
  value: name,
  label,
  hint,
}));

export function isAgentName(value: unknown): value is AgentName {
  return isRegisteredAgentName(value);
}

export function normalizeAgents(values: string[]): AgentName[] {
  const aliases = adapterAliasMap();
  const expanded = values.flatMap((value) =>
    value.toLowerCase() === 'all'
      ? supportedAgents.map(({ value: name }) => name)
      : value.split(/[\s,]+/),
  );
  const agents = [...new Set(expanded.filter(Boolean).map((value) => aliases.get(value) || value))];
  const known = new Set<string>(supportedAgentNames);
  const invalid = agents.filter((value) => !known.has(value));
  if (invalid.length > 0)
    throw new HarnessmithError('CLI_USAGE', `Unsupported agent: ${invalid.join(', ')}`, 2, {
      reason: 'unsupported-agent',
    });
  return agents as AgentName[];
}
