import { normalizeRepositoryMap, normalizeRepositoryRelation } from './repository-map-format.js';
import type {
  ObservationDiscovery,
  RepositoryEntry,
  RepositoryMap,
  RepositoryObservationSet,
  RepositoryRelation,
} from './repository-map-types.js';
import {
  assertValidRepositoryMap,
  isNonEmptyString,
  isRecord,
  objectUnknownFields,
  relationFields,
  relationKey,
  repositoryFields,
  validateRepositoryMap,
} from './repository-map-validation.js';

interface ReconcileProposal {
  kind: 'repository' | 'relation';
  reason: string;
  value: unknown;
}

interface ReconcileState {
  map: RepositoryMap;
  apply: boolean;
  trusted: boolean;
  proposals: ReconcileProposal[];
  appliedRepositories: string[];
  unchangedRepositories: string[];
  appliedRelations: string[];
  unchangedRelations: string[];
}

function stripDiscovery<T extends { discovery: ObservationDiscovery }>(
  value: T,
): Omit<T, 'discovery'> {
  const { discovery: _discovery, ...rest } = value;
  return rest;
}

function assertObservationEnvelope(observations: RepositoryObservationSet): void {
  if (!isRecord(observations) || observations.version !== 1 || !isRecord(observations.extractor)) {
    throw new Error('Invalid repository observation set');
  }
  if (
    objectUnknownFields(observations, ['version', 'extractor', 'repositories', 'relations'])
      .length > 0 ||
    objectUnknownFields(observations.extractor, ['id', 'version']).length > 0 ||
    !isNonEmptyString(observations.extractor.id, 120) ||
    !isNonEmptyString(observations.extractor.version, 80) ||
    !Array.isArray(observations.repositories) ||
    !Array.isArray(observations.relations)
  ) {
    throw new Error('Invalid repository observation set');
  }
}

function validatedObservationRepositories(
  observations: RepositoryObservationSet,
): RepositoryEntry[] {
  return observations.repositories.map((observation) => {
    if (
      !isRecord(observation) ||
      !['deterministic', 'heuristic'].includes(String(observation.discovery)) ||
      objectUnknownFields(observation, [...repositoryFields, 'discovery']).length > 0
    ) {
      throw new Error('Invalid repository observations: malformed repository observation');
    }
    const candidate = stripDiscovery(observation);
    const report = validateRepositoryMap({
      schemaVersion: 1,
      repositories: [candidate],
      relations: [],
    });
    if (!report.valid)
      throw new Error(`Invalid repository observations:\n${report.issues.join('\n')}`);
    return candidate as unknown as RepositoryEntry;
  });
}

function assertRelationObservations(
  observations: RepositoryObservationSet,
  repositories: RepositoryEntry[],
): void {
  for (const observation of observations.relations) {
    if (
      !isRecord(observation) ||
      !['deterministic', 'heuristic'].includes(String(observation.discovery)) ||
      objectUnknownFields(observation, [...relationFields, 'discovery']).length > 0
    ) {
      throw new Error('Invalid repository observations: malformed relation observation');
    }
    const report = validateRepositoryMap({
      schemaVersion: 1,
      repositories,
      relations: [stripDiscovery(observation)],
    });
    if (!report.valid)
      throw new Error(`Invalid repository observations:\n${report.issues.join('\n')}`);
  }
}

function proposalReason(state: ReconcileState): string {
  return state.trusted ? 'manual-review' : 'untrusted-extractor';
}

function reconcileRepository(
  state: ReconcileState,
  observation: RepositoryObservationSet['repositories'][number],
): void {
  const candidate = stripDiscovery(observation) as RepositoryEntry;
  const existingIndex = state.map.repositories.findIndex(({ id }) => id === observation.id);
  if (
    existingIndex >= 0 &&
    JSON.stringify(state.map.repositories[existingIndex]) === JSON.stringify(candidate)
  ) {
    state.unchangedRepositories.push(observation.id);
    return;
  }
  if (!state.apply || !state.trusted || observation.discovery !== 'deterministic') {
    state.proposals.push({
      kind: 'repository',
      reason: proposalReason(state),
      value: observation,
    });
    return;
  }
  if (existingIndex >= 0) state.map.repositories[existingIndex] = candidate;
  else state.map.repositories.push(candidate);
  state.appliedRepositories.push(observation.id);
}

function reconcileRelation(
  state: ReconcileState,
  observation: RepositoryObservationSet['relations'][number],
): void {
  const candidate = normalizeRepositoryRelation(stripDiscovery(observation) as RepositoryRelation);
  const key = relationKey(candidate);
  const existingIndex = state.map.relations.findIndex((relation) => relationKey(relation) === key);
  if (
    existingIndex >= 0 &&
    JSON.stringify(state.map.relations[existingIndex]) === JSON.stringify(candidate)
  ) {
    state.unchangedRelations.push(key);
    return;
  }
  if (!state.apply || !state.trusted || observation.discovery !== 'deterministic') {
    state.proposals.push({ kind: 'relation', reason: proposalReason(state), value: observation });
    return;
  }
  if (existingIndex >= 0) state.map.relations[existingIndex] = candidate;
  else state.map.relations.push(candidate);
  state.appliedRelations.push(key);
}

export function reconcileRepositoryMap(
  map: RepositoryMap,
  observations: RepositoryObservationSet,
  { apply = false, trustedExtractors = [] }: { apply?: boolean; trustedExtractors?: string[] } = {},
) {
  assertValidRepositoryMap(map);
  assertObservationEnvelope(observations);
  const observationRepositories = validatedObservationRepositories(observations);
  const validationRepositories = [
    ...map.repositories,
    ...observationRepositories.filter(
      (candidate) => !map.repositories.some(({ id }) => id === candidate.id),
    ),
  ];
  assertRelationObservations(observations, validationRepositories);
  const state: ReconcileState = {
    map: structuredClone(normalizeRepositoryMap(map)),
    apply,
    trusted: trustedExtractors.includes(observations.extractor.id),
    proposals: [],
    appliedRepositories: [],
    unchangedRepositories: [],
    appliedRelations: [],
    unchangedRelations: [],
  };
  for (const observation of observations.repositories) reconcileRepository(state, observation);
  for (const observation of observations.relations) reconcileRelation(state, observation);
  assertValidRepositoryMap(state.map);
  return { ...state, map: normalizeRepositoryMap(state.map), observations };
}
