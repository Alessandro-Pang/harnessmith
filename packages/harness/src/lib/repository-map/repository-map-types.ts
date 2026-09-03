export const repositoryRelationTypes = [
  'package',
  'http-api',
  'rpc',
  'event',
  'artifact',
  'proxy',
  'migration',
  'extension',
] as const;

export type RepositoryRelationType = (typeof repositoryRelationTypes)[number];
export type ObservationDiscovery = 'deterministic' | 'heuristic';

export interface RepositoryEntry {
  id: string;
  description: string;
  checkout: string;
  owns: string[];
  aliases: string[];
  remotes: string[];
  sources: string[];
}

interface RepositoryEvidence {
  repository: string;
  side: 'provider' | 'consumer' | 'contract';
  path: string;
}

export interface RepositoryRelation {
  type: RepositoryRelationType;
  provider: string;
  contract: string;
  consumer: string;
  evidence: RepositoryEvidence[];
}

export interface RepositoryMap {
  schemaVersion: 1;
  repositories: RepositoryEntry[];
  relations: RepositoryRelation[];
}

export interface RepositoryMapValidation {
  valid: boolean;
  issues: string[];
}

export interface RepositoryObservationSet {
  version: 1;
  extractor: { id: string; version: string };
  repositories: Array<RepositoryEntry & { discovery: ObservationDiscovery }>;
  relations: Array<RepositoryRelation & { discovery: ObservationDiscovery }>;
}

export interface VerificationSource {
  repository: string;
  path: string;
  fingerprint: string;
}

export interface RepositoryVerificationState {
  version: 1;
  checkedAt: string;
  extractorVersion: string;
  mapFingerprint: string;
  result: 'passed' | 'failed';
  sources: VerificationSource[];
  misses: string[];
}

export interface PackageDiscoveryResult {
  observations: RepositoryObservationSet;
  skipped: string[];
}
