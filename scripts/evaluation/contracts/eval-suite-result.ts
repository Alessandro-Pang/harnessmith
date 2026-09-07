import type { CodexSuiteSummary } from '../codex/eval-codex-suite.js';

export function suiteGateResult(
  suite: CodexSuiteSummary,
  current: { packageArtifactSha256: string; behaviorSha256: string },
  maxAgeDays: number,
  hosts: string[],
) {
  const exact = suite.results.map((result) => `codex/${result.scenarioId}`).sort();
  const infraBlocked = suite.results
    .filter((result) => result.outcome.startsWith('infra-'))
    .map((result) => `codex/${result.scenarioId}`)
    .sort();
  return {
    valid: true as const,
    assurance: 'maintainer-attested-structure' as const,
    packageArtifactSha256: current.packageArtifactSha256,
    behaviorSha256: current.behaviorSha256,
    coverageCount: suite.results.length,
    exactArtifactCoverageCount: suite.results.length,
    inheritedBehaviorCoverageCount: 0,
    inheritedFrom: [],
    evidence: { exact, inherited: [], infraBlocked },
    hosts,
    scenarios: suite.results.map((result) => result.scenarioId),
    maxAgeDays,
  };
}
