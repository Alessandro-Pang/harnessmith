import { isAbsolute } from 'node:path';
import {
  type RepositoryMap,
  type RepositoryMapValidation,
  type RepositoryRelation,
  type RepositoryRelationType,
  repositoryRelationTypes,
} from './repository-map-types.js';

export const repositoryFields = [
  'id',
  'description',
  'checkout',
  'owns',
  'aliases',
  'remotes',
  'sources',
];
export const relationFields = ['type', 'provider', 'contract', 'consumer', 'evidence'];
const topLevelFields = ['schemaVersion', 'repositories', 'relations'];
const evidenceFields = ['repository', 'side', 'path'];
const idPattern = /^[a-z0-9][a-z0-9._-]{0,79}$/;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function objectUnknownFields(value: Record<string, unknown>, allowed: string[]): string[] {
  return Object.keys(value).filter((key) => !allowed.includes(key));
}

export function isNonEmptyString(
  value: unknown,
  maximum = Number.POSITIVE_INFINITY,
): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maximum;
}

function isStringArray(value: unknown, maximum: number): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= maximum &&
    value.every((entry) => isNonEmptyString(entry, 500))
  );
}

function safeRelativePath(path: unknown): path is string {
  if (!isNonEmptyString(path, 500) || isAbsolute(path)) return false;
  const normalized = path.replaceAll('\\', '/');
  return !normalized.split('/').includes('..') && normalized !== '.';
}

export function relationKey(
  relation: Pick<RepositoryRelation, 'type' | 'provider' | 'contract' | 'consumer'>,
): string {
  return [relation.type, relation.provider, relation.contract, relation.consumer].join('\u001f');
}

function validateRepository(
  repository: unknown,
  index: number,
  repositoryIds: Set<string>,
  issues: string[],
): void {
  const label = `repositories[${index}]`;
  if (!isRecord(repository)) {
    issues.push(`${label} must be an object`);
    return;
  }
  for (const field of objectUnknownFields(repository, repositoryFields)) {
    issues.push(`Unknown repository field: ${field} at ${label}`);
  }
  if (!isNonEmptyString(repository.id, 80) || !idPattern.test(repository.id)) {
    issues.push(`${label}.id must be a stable lowercase repository identifier`);
  } else if (repositoryIds.has(repository.id))
    issues.push(`Duplicate repository id: ${repository.id}`);
  else repositoryIds.add(repository.id);
  if (!isNonEmptyString(repository.description, 240)) {
    issues.push(`${label}.description is required and must be at most 240 characters`);
  }
  if (!safeRelativePath(repository.checkout)) {
    issues.push(`${label}.checkout must be relative to the repository root`);
  }
  if (!isStringArray(repository.owns, 12))
    issues.push(`${label}.owns must contain at most 12 strings`);
  if (!isStringArray(repository.aliases, 12))
    issues.push(`${label}.aliases must contain at most 12 strings`);
  if (!isStringArray(repository.remotes, 8))
    issues.push(`${label}.remotes must contain at most 8 strings`);
  if (!isStringArray(repository.sources, 6) || repository.sources.length === 0) {
    issues.push(`${label}.sources must contain 1 to 6 authoritative paths`);
  } else if (!repository.sources.every(safeRelativePath)) {
    issues.push(`${label}.sources must contain repository-relative paths`);
  }
}

function validateEvidence(
  evidence: unknown,
  label: string,
  relation: Record<string, unknown>,
  repositoryIds: Set<string>,
  sides: Set<string>,
  issues: string[],
): void {
  if (!isRecord(evidence)) {
    issues.push(`${label} must be an object`);
    return;
  }
  for (const field of objectUnknownFields(evidence, evidenceFields)) {
    issues.push(`Unknown evidence field: ${field} at ${label}`);
  }
  if (!['provider', 'consumer', 'contract'].includes(String(evidence.side))) {
    issues.push(`${label}.side is unsupported`);
  } else sides.add(String(evidence.side));
  if (!isNonEmptyString(evidence.repository, 80) || !repositoryIds.has(evidence.repository)) {
    issues.push(`${label}.repository references a missing repository`);
  }
  if (!safeRelativePath(evidence.path)) issues.push(`${label}.path must be repository-relative`);
  if (evidence.side === 'provider' && evidence.repository !== relation.provider) {
    issues.push(`${label} provider evidence must belong to ${String(relation.provider)}`);
  }
  if (evidence.side === 'consumer' && evidence.repository !== relation.consumer) {
    issues.push(`${label} consumer evidence must belong to ${String(relation.consumer)}`);
  }
}

function validateRelation(
  relation: unknown,
  index: number,
  repositoryIds: Set<string>,
  relationKeys: Set<string>,
  issues: string[],
): void {
  const label = `relations[${index}]`;
  if (!isRecord(relation)) {
    issues.push(`${label} must be an object`);
    return;
  }
  for (const field of objectUnknownFields(relation, relationFields)) {
    issues.push(`Unknown relation field: ${field} at ${label}`);
  }
  if (!repositoryRelationTypes.includes(relation.type as RepositoryRelationType)) {
    issues.push(`${label}.type is unsupported`);
  }
  for (const endpoint of ['provider', 'consumer'] as const) {
    if (!isNonEmptyString(relation[endpoint], 80)) issues.push(`${label}.${endpoint} is required`);
    else if (!repositoryIds.has(relation[endpoint])) {
      issues.push(`${label}.${endpoint} references missing repository: ${relation[endpoint]}`);
    }
  }
  if (!isNonEmptyString(relation.contract, 240)) {
    issues.push(`${label}.contract is required and must be at most 240 characters`);
  }
  const evidence = Array.isArray(relation.evidence) ? relation.evidence : [];
  if (evidence.length < 2 || evidence.length > 6) {
    issues.push(`${label}.evidence must contain 2 to 6 direct source pointers`);
  }
  const sides = new Set<string>();
  evidence.forEach((item, evidenceIndex) => {
    validateEvidence(
      item,
      `${label}.evidence[${evidenceIndex}]`,
      relation,
      repositoryIds,
      sides,
      issues,
    );
  });
  if (!sides.has('provider')) issues.push(`${label} is missing provider evidence`);
  if (!sides.has('consumer')) issues.push(`${label} is missing consumer evidence`);
  if (
    isNonEmptyString(relation.type) &&
    isNonEmptyString(relation.provider) &&
    isNonEmptyString(relation.contract) &&
    isNonEmptyString(relation.consumer)
  ) {
    const key = relationKey(relation as unknown as RepositoryRelation);
    if (relationKeys.has(key))
      issues.push(`Duplicate relation key: ${key.replaceAll('\u001f', ' / ')}`);
    else relationKeys.add(key);
  }
}

export function validateRepositoryMap(value: unknown): RepositoryMapValidation {
  const issues: string[] = [];
  if (!isRecord(value)) return { valid: false, issues: ['Repository map must be an object'] };
  for (const field of objectUnknownFields(value, topLevelFields))
    issues.push(`Unknown top-level field: ${field}`);
  if (value.schemaVersion !== 1) issues.push('schemaVersion must be 1');
  const repositories = Array.isArray(value.repositories) ? value.repositories : [];
  const relations = Array.isArray(value.relations) ? value.relations : [];
  if (!Array.isArray(value.repositories)) issues.push('repositories must be an array');
  if (!Array.isArray(value.relations)) issues.push('relations must be an array');
  if (repositories.length > 200) issues.push('repositories exceeds the 200 entry budget');
  if (relations.length > 1000) issues.push('relations exceeds the 1000 edge budget');
  const repositoryIds = new Set<string>();
  repositories.forEach((repository, index) => {
    validateRepository(repository, index, repositoryIds, issues);
  });
  const relationKeys = new Set<string>();
  relations.forEach((relation, index) => {
    validateRelation(relation, index, repositoryIds, relationKeys, issues);
  });
  return { valid: issues.length === 0, issues };
}

export function assertValidRepositoryMap(value: unknown): asserts value is RepositoryMap {
  const report = validateRepositoryMap(value);
  if (!report.valid) throw new Error(`Invalid repository map:\n${report.issues.join('\n')}`);
}
