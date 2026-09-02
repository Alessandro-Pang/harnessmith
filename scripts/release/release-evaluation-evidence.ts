import type { EvaluationEvidence, InheritedEvaluationSource } from '../evaluation/eval-contract.js';

const sha256Pattern = /^[a-f0-9]{64}$/u;

export function evaluationMatrix(
  requiredHosts: readonly string[],
  scenarios: Readonly<Record<string, string>>,
): string[] {
  return requiredHosts.flatMap((host) =>
    Object.keys(scenarios).map((scenario) => `${host}/${scenario}`),
  );
}

function sourceKey(source: InheritedEvaluationSource): string {
  return `${source.packageVersion}\0${source.packageArtifactSha256}`;
}

export function releaseEvaluationEvidenceIsValid(
  value: unknown,
  exactArtifactCoverageCount: number,
  inheritedBehaviorCoverageCount: number,
  inheritedFrom: readonly InheritedEvaluationSource[],
  requiredHosts: readonly string[],
  scenarios: Readonly<Record<string, string>>,
): value is EvaluationEvidence {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const evidence = value as Partial<EvaluationEvidence>;
  if (
    !Array.isArray(evidence.exact) ||
    !Array.isArray(evidence.inherited) ||
    !Array.isArray(evidence.infraBlocked)
  ) {
    return false;
  }
  const matrix = evaluationMatrix(requiredHosts, scenarios);
  const exact = evidence.exact;
  const inherited = evidence.inherited;
  const infraBlocked = evidence.infraBlocked;
  const inheritedEntriesValid = inherited.every(
    (entry) =>
      !!entry &&
      typeof entry === 'object' &&
      typeof entry.cell === 'string' &&
      matrix.includes(entry.cell) &&
      typeof entry.packageVersion === 'string' &&
      entry.packageVersion.length > 0 &&
      typeof entry.packageArtifactSha256 === 'string' &&
      sha256Pattern.test(entry.packageArtifactSha256),
  );
  if (!inheritedEntriesValid) return false;
  const inheritedCells = inherited.map((entry) => entry?.cell);
  const allCells = [...exact, ...inheritedCells, ...infraBlocked];
  const uniqueDeclaredSources = new Map(
    inherited.map(({ packageVersion, packageArtifactSha256 }) => {
      const source = { packageVersion, packageArtifactSha256 };
      return [sourceKey(source), source];
    }),
  );
  return (
    exact.length === exactArtifactCoverageCount &&
    inherited.length === inheritedBehaviorCoverageCount &&
    exact.every((cell) => typeof cell === 'string' && matrix.includes(cell)) &&
    infraBlocked.every((cell) => typeof cell === 'string' && matrix.includes(cell)) &&
    new Set(allCells).size === allCells.length &&
    uniqueDeclaredSources.size === inheritedFrom.length &&
    inheritedFrom.every((source) => uniqueDeclaredSources.has(sourceKey(source)))
  );
}
