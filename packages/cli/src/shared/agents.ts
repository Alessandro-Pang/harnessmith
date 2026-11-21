/**
 * Pure CLI argument accumulation for repeated/comma-separated `--agent` values.
 * Registry-dependent selection (supportedAgents, normalizeAgents, isAgentName) lives in
 * adapters/agent-selection so the shared layer carries no adapter import.
 */
export function collectAgents(value: string, previous: string[] = []): string[] {
  return [
    ...previous,
    ...value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  ];
}
