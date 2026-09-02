import type { RepositoryMap, RepositoryVerificationState } from './repository-map-types.js';
import { assertValidRepositoryMap } from './repository-map-validation.js';
import { verifyRepositoryMap } from './repository-map-verification.js';

export function maintainRepositoryMap(
  map: RepositoryMap,
  state: RepositoryVerificationState | null,
  repositoryRoot: string,
  now = new Date(),
  maxAgeDays = 30,
) {
  assertValidRepositoryMap(map);
  const stale: string[] = [];
  if (!state) return { stale: ['verification state is missing'], missing: [], withinBudget: true };
  const checkedAt = Date.parse(state.checkedAt);
  if (!Number.isFinite(checkedAt)) stale.push('verification checkedAt is invalid');
  else if (now.getTime() - checkedAt > maxAgeDays * 86_400_000) {
    stale.push(`verification is older than ${maxAgeDays} days`);
  }
  const current = verifyRepositoryMap(map, repositoryRoot, {
    checkedAt: now.toISOString(),
    extractorVersion: state.extractorVersion,
  });
  const previous = new Map(
    state.sources.map((source) => [`${source.repository}\u001f${source.path}`, source.fingerprint]),
  );
  for (const source of current.sources) {
    const key = `${source.repository}\u001f${source.path}`;
    if (!previous.has(key))
      stale.push(`${source.repository}/${source.path}: not present in verification state`);
    else if (previous.get(key) !== source.fingerprint)
      stale.push(`${source.repository}/${source.path}: fingerprint changed`);
  }
  if (state.mapFingerprint !== current.mapFingerprint)
    stale.push('canonical map fingerprint changed');
  return {
    stale,
    missing: current.misses,
    withinBudget: map.repositories.length <= 200 && map.relations.length <= 1000,
  };
}
