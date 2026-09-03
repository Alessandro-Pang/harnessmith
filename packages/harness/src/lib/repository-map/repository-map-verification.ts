import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertSafePath, isPathInside } from '../filesystem/safe-path.js';
import { serializeRepositoryMap } from './repository-map-format.js';
import type {
  PackageDiscoveryResult,
  RepositoryMap,
  RepositoryObservationSet,
  RepositoryVerificationState,
  VerificationSource,
} from './repository-map-types.js';
import {
  assertValidRepositoryMap,
  isNonEmptyString,
  isRecord,
} from './repository-map-validation.js';

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function authoritativeSources(map: RepositoryMap): Array<{ repository: string; path: string }> {
  const values = new Map<string, { repository: string; path: string }>();
  for (const repository of map.repositories) {
    for (const path of repository.sources)
      values.set(`${repository.id}\u001f${path}`, { repository: repository.id, path });
  }
  for (const relation of map.relations) {
    for (const evidence of relation.evidence) {
      values.set(`${evidence.repository}\u001f${evidence.path}`, {
        repository: evidence.repository,
        path: evidence.path,
      });
    }
  }
  return [...values.values()].sort((left, right) =>
    `${left.repository}\u001f${left.path}`.localeCompare(`${right.repository}\u001f${right.path}`),
  );
}

function sourceFile(
  map: RepositoryMap,
  repositoryRoot: string,
  source: { repository: string; path: string },
): string | null {
  const repository = map.repositories.find(({ id }) => id === source.repository);
  if (!repository) return null;
  const checkout = resolve(repositoryRoot, repository.checkout);
  const path = resolve(checkout, source.path);
  if (!isPathInside(repositoryRoot, checkout) || !isPathInside(checkout, path)) return null;
  try {
    assertSafePath(repositoryRoot, checkout);
    assertSafePath(checkout, path);
  } catch {
    return null;
  }
  return path;
}

interface PackageManifest {
  name?: unknown;
  dependencies?: unknown;
  devDependencies?: unknown;
  peerDependencies?: unknown;
  optionalDependencies?: unknown;
}

function stringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

function readPackageManifests(
  map: RepositoryMap,
  repositoryRoot: string,
  skipped: string[],
): Map<string, PackageManifest> {
  const manifests = new Map<string, PackageManifest>();
  for (const repository of map.repositories) {
    const path = sourceFile(map, repositoryRoot, {
      repository: repository.id,
      path: 'package.json',
    });
    if (!path || !existsSync(path)) continue;
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.size > 1024 * 1024) {
      skipped.push(`${repository.id}/package.json: not a regular manifest within 1 MiB`);
      continue;
    }
    try {
      manifests.set(repository.id, JSON.parse(readFileSync(path, 'utf8')) as PackageManifest);
    } catch (error) {
      skipped.push(
        `${repository.id}/package.json: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return manifests;
}

function packageProviders(manifests: Map<string, PackageManifest>): Map<string, string[]> {
  const providers = new Map<string, string[]>();
  for (const [repository, manifest] of manifests) {
    if (!isNonEmptyString(manifest.name, 240)) continue;
    const current = providers.get(manifest.name) || [];
    current.push(repository);
    providers.set(manifest.name, current);
  }
  return providers;
}

function packageRelations(
  manifests: Map<string, PackageManifest>,
  providers: Map<string, string[]>,
  skipped: string[],
): RepositoryObservationSet['relations'] {
  const relations: RepositoryObservationSet['relations'] = [];
  for (const [consumer, manifest] of manifests) {
    const dependencies = {
      ...stringRecord(manifest.dependencies),
      ...stringRecord(manifest.devDependencies),
      ...stringRecord(manifest.peerDependencies),
      ...stringRecord(manifest.optionalDependencies),
    };
    for (const contract of Object.keys(dependencies).sort()) {
      const candidates = providers.get(contract) || [];
      if (candidates.length > 1) {
        skipped.push(
          `${consumer} -> ${contract}: multiple local providers (${candidates.join(', ')})`,
        );
        continue;
      }
      const provider = candidates[0];
      if (!provider || provider === consumer) continue;
      relations.push({
        discovery: 'deterministic',
        type: 'package',
        provider,
        contract,
        consumer,
        evidence: [
          { repository: provider, side: 'provider', path: 'package.json' },
          { repository: consumer, side: 'consumer', path: 'package.json' },
        ],
      });
    }
  }
  return relations;
}

export function discoverPackageRelations(
  map: RepositoryMap,
  repositoryRoot: string,
): PackageDiscoveryResult {
  assertValidRepositoryMap(map);
  const skipped: string[] = [];
  const manifests = readPackageManifests(map, repositoryRoot, skipped);
  return {
    observations: {
      version: 1,
      extractor: { id: 'harness.package-manifest', version: '1' },
      repositories: [],
      relations: packageRelations(manifests, packageProviders(manifests), skipped),
    },
    skipped,
  };
}

export function verifyRepositoryMap(
  map: RepositoryMap,
  repositoryRoot: string,
  { checkedAt = new Date().toISOString(), extractorVersion = 'repository-map.v1' } = {},
): RepositoryVerificationState {
  assertValidRepositoryMap(map);
  const sources: VerificationSource[] = [];
  const misses: string[] = [];
  for (const source of authoritativeSources(map)) {
    const path = sourceFile(map, repositoryRoot, source);
    if (!path || !existsSync(path) || !lstatSync(path).isFile()) {
      misses.push(`${source.repository}/${source.path}: missing regular file`);
      continue;
    }
    sources.push({ ...source, fingerprint: sha256(path) });
  }
  return {
    version: 1,
    checkedAt,
    extractorVersion,
    mapFingerprint: createHash('sha256').update(serializeRepositoryMap(map)).digest('hex'),
    result: misses.length === 0 ? 'passed' : 'failed',
    sources,
    misses,
  };
}
