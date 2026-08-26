import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type ReleaseRiskAcceptance, releaseRiskAcceptanceIsValid } from './release-state.js';

export function loadReleaseRiskAcceptance(
  path: string,
  packageVersion: string,
  packageArtifactSha256: string,
): ReleaseRiskAcceptance {
  const input = JSON.parse(readFileSync(resolve(path), 'utf8')) as Partial<
    Omit<ReleaseRiskAcceptance, 'packageVersion' | 'packageArtifactSha256'>
  >;
  const acceptance: ReleaseRiskAcceptance = {
    schemaVersion: 1,
    acceptedAt: String(input.acceptedAt ?? ''),
    authorizedBy: input.authorizedBy === 'user' ? 'user' : ('' as 'user'),
    reason: String(input.reason ?? ''),
    uncoveredScenarios: Array.isArray(input.uncoveredScenarios)
      ? input.uncoveredScenarios.map(String)
      : [],
    packageVersion,
    packageArtifactSha256,
  };
  if (!releaseRiskAcceptanceIsValid(acceptance, packageArtifactSha256, packageVersion)) {
    throw new Error('Invalid explicit Host Eval risk acceptance');
  }
  return acceptance;
}
