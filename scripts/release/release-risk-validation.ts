import { isAgentName } from '../../src/shared/agents.js';
import type { ReleaseRiskAcceptance } from './release-state.js';

function isExactStringSet(actual: readonly string[], expected: readonly string[]): boolean {
  return (
    actual.length === expected.length &&
    new Set(actual).size === actual.length &&
    actual.every((entry) => expected.includes(entry))
  );
}

export function releaseRiskAcceptanceIsValid(
  value: unknown,
  artifactSha256: unknown,
  packageVersion: unknown,
  expectedUncoveredScenarios: readonly string[],
): value is ReleaseRiskAcceptance {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const acceptance = value as Partial<ReleaseRiskAcceptance>;
  const infraBlockedScenarios = acceptance.infraBlockedScenarios ?? [];
  return (
    acceptance.schemaVersion === 1 &&
    acceptance.authorizedBy === 'user' &&
    typeof acceptance.acceptedAt === 'string' &&
    Number.isFinite(Date.parse(acceptance.acceptedAt)) &&
    typeof acceptance.reason === 'string' &&
    acceptance.reason.trim().length > 0 &&
    acceptance.reason.length <= 500 &&
    Array.isArray(acceptance.uncoveredScenarios) &&
    acceptance.uncoveredScenarios.length > 0 &&
    isExactStringSet(acceptance.uncoveredScenarios, expectedUncoveredScenarios) &&
    acceptance.uncoveredScenarios.every((entry) => {
      if (typeof entry !== 'string') return false;
      const [host, scenario, extra] = entry.split('/');
      return !extra && isAgentName(host) && /^[a-z0-9][a-z0-9-]*$/u.test(scenario ?? '');
    }) &&
    Array.isArray(infraBlockedScenarios) &&
    new Set(infraBlockedScenarios).size === infraBlockedScenarios.length &&
    infraBlockedScenarios.every(
      (entry) =>
        typeof entry === 'string' && acceptance.uncoveredScenarios?.includes(entry) === true,
    ) &&
    acceptance.packageVersion === packageVersion &&
    acceptance.packageArtifactSha256 === artifactSha256
  );
}
