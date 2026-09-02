import {
  adapterAliasMap,
  adapterRegistry,
  isRegisteredAgentName,
  supportedAgentNames,
  type AgentName,
} from '../adapters/adapter-registry.js';
import { HarnessmithError } from './types.js';

export { supportedAgentNames } from '../adapters/adapter-registry.js';

export const supportedAgents = adapterRegistry.map(({ name, label, hint }) => ({
  value: name,
  label,
  hint,
}));

export function isAgentName(value: unknown): value is AgentName {
  return isRegisteredAgentName(value);
}

export function collectAgents(value: string, previous: string[] = []): string[] {
  return [
    ...previous,
    ...value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  ];
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
    throw new HarnessmithError('CLI_USAGE', `Unsupported agent: ${invalid.join(', ')}`, 2);
  return agents as AgentName[];
}
