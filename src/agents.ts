import type { AgentName } from './types.js';
import { HarnessmithError } from './types.js';

export const supportedAgentNames = [
  'codex',
  'cursor',
  'claude',
  'opencode',
] as const satisfies readonly AgentName[];

export const supportedAgents = [
  { value: 'codex', label: 'Codex', hint: 'global configuration' },
  { value: 'cursor', label: 'Cursor', hint: 'current project' },
  { value: 'claude', label: 'Claude Code', hint: 'global configuration' },
  { value: 'opencode', label: 'OpenCode', hint: 'global configuration' },
];

export function isAgentName(value: unknown): value is AgentName {
  return (
    typeof value === 'string' &&
    supportedAgentNames.includes(value as (typeof supportedAgentNames)[number])
  );
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
  const aliases = new Map<string, AgentName>([
    ['1', 'codex'],
    ['2', 'cursor'],
    ['3', 'claude'],
    ['4', 'opencode'],
    ['claude-code', 'claude'],
  ]);
  const expanded = values.flatMap((value) =>
    value.toLowerCase() === 'all'
      ? supportedAgents.map(({ value: name }) => name)
      : value.split(/[\s,]+/),
  );
  const agents = [...new Set(expanded.filter(Boolean).map((value) => aliases.get(value) || value))];
  const known = new Set(supportedAgents.map(({ value }) => value));
  const invalid = agents.filter((value) => !known.has(value));
  if (invalid.length > 0)
    throw new HarnessmithError('CLI_USAGE', `Unsupported agent: ${invalid.join(', ')}`, 2);
  return agents as AgentName[];
}
