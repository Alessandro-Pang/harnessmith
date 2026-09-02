import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { withExclusiveDirectoryLock } from '../../lib/filesystem/exclusive-lock.js';
import { atomicWriteMany } from '../../lib/filesystem/files.js';
import {
  discoverPackageRelations,
  parseRepositoryMap,
  type RepositoryMap,
  type RepositoryObservationSet,
  type RepositoryVerificationState,
  reconcileRepositoryMap,
  renderRepositoryMap,
  serializeRepositoryMap,
  verifyRepositoryMap,
} from '../../lib/repository-map/repository-map.js';
import {
  assertGeneratedRepositoryMapView,
  readCanonicalRepositoryMap,
  repositoryMapPaths,
  writeRepositoryMapJson,
} from '../../lib/repository-map/repository-map-runtime.js';
import { withUserDataCoordinationLocks } from '../../lib/filesystem/user-data-lock.js';
import { assertRuntimeCanMutate } from '../../runtime.js';
import type { Io, Runtime } from '../../types.js';

function writeMapAndView(runtime: Runtime, map: RepositoryMap): void {
  const target = repositoryMapPaths(runtime);
  assertGeneratedRepositoryMapView(target.view);
  withUserDataCoordinationLocks([runtime.personalHome], [], () =>
    withExclusiveDirectoryLock(runtime.personalHome, 'Personal overlay', () =>
      atomicWriteMany([
        { path: target.canonical, content: serializeRepositoryMap(map) },
        { path: target.view, content: renderRepositoryMap(map) },
      ]),
    ),
  );
}

function writeVerifiedMap(
  runtime: Runtime,
  map: RepositoryMap,
  verification: RepositoryVerificationState,
): void {
  const target = repositoryMapPaths(runtime);
  assertGeneratedRepositoryMapView(target.view);
  withUserDataCoordinationLocks([runtime.personalHome, target.state], [], () =>
    withExclusiveDirectoryLock(runtime.personalHome, 'Personal overlay', () =>
      withExclusiveDirectoryLock(target.state, 'Repository map state', () =>
        atomicWriteMany([
          { path: target.canonical, content: serializeRepositoryMap(map) },
          { path: target.view, content: renderRepositoryMap(map) },
          { path: target.verification, content: `${JSON.stringify(verification, null, 2)}\n` },
        ]),
      ),
    ),
  );
}

export function repositoryMapReconcile(
  runtime: Runtime,
  observationsPath: string,
  { apply = false, json = false }: { apply?: boolean; json?: boolean } = {},
  io: Io = console,
): number {
  const observations = JSON.parse(
    readFileSync(observationsPath, 'utf8'),
  ) as RepositoryObservationSet;
  const result = reconcileRepositoryMap(readCanonicalRepositoryMap(runtime), observations, {
    apply,
    trustedExtractors: [],
  });
  if (apply && (result.appliedRepositories.length > 0 || result.appliedRelations.length > 0)) {
    assertRuntimeCanMutate(runtime);
    writeMapAndView(runtime, result.map);
  }
  const report = {
    appliedRepositories: result.appliedRepositories,
    appliedRelations: result.appliedRelations,
    unchangedRepositories: result.unchangedRepositories,
    unchangedRelations: result.unchangedRelations,
    proposals: result.proposals,
  };
  if (json) writeRepositoryMapJson(io, report);
  else {
    io.log(`Applied repositories: ${report.appliedRepositories.length}`);
    io.log(`Applied relations: ${report.appliedRelations.length}`);
    io.log(`Proposals requiring review: ${report.proposals.length}`);
  }
  return 0;
}

export function repositoryMapDiscoverPackages(
  runtime: Runtime,
  { apply = false, json = false }: { apply?: boolean; json?: boolean } = {},
  io: Io = console,
): number {
  const map = readCanonicalRepositoryMap(runtime);
  const discovery = discoverPackageRelations(map, runtime.repositoryRoot);
  const result = reconcileRepositoryMap(map, discovery.observations, {
    apply,
    trustedExtractors: ['harness.package-manifest'],
  });
  if (apply && result.appliedRelations.length > 0) {
    assertRuntimeCanMutate(runtime);
    const verification = verifyRepositoryMap(result.map, runtime.repositoryRoot);
    if (verification.result !== 'passed') {
      throw new Error(
        `Discovered map cannot be applied because source verification failed:\n${verification.misses.join('\n')}`,
      );
    }
    writeVerifiedMap(runtime, result.map, verification);
  }
  const report = {
    appliedRelations: result.appliedRelations,
    unchangedRelations: result.unchangedRelations,
    proposals: result.proposals,
    skipped: discovery.skipped,
  };
  if (json) writeRepositoryMapJson(io, report);
  else {
    io.log(`Discovered package relations: ${discovery.observations.relations.length}`);
    io.log(`Applied package relations: ${report.appliedRelations.length}`);
    for (const skipped of report.skipped) io.log(`  skipped ${skipped}`);
  }
  return 0;
}

function applyMigration(
  runtime: Runtime,
  map: RepositoryMap,
  verification: RepositoryVerificationState,
  legacy: boolean,
  backup: string,
): void {
  const target = repositoryMapPaths(runtime);
  withUserDataCoordinationLocks([runtime.personalHome, target.state], [], () =>
    withExclusiveDirectoryLock(runtime.personalHome, 'Personal overlay', () =>
      withExclusiveDirectoryLock(target.state, 'Repository map state', () => {
        const entries = [];
        if (legacy) {
          if (existsSync(backup))
            throw new Error(`Legacy repository map backup already exists: ${backup}`);
          entries.push({ path: backup, content: readFileSync(target.view, 'utf8') });
        }
        entries.push(
          { path: target.canonical, content: serializeRepositoryMap(map) },
          { path: target.view, content: renderRepositoryMap(map) },
          { path: target.verification, content: `${JSON.stringify(verification, null, 2)}\n` },
        );
        atomicWriteMany(entries);
      }),
    ),
  );
}

export function repositoryMapMigrate(
  runtime: Runtime,
  candidatePath: string,
  { apply = false, json = false }: { apply?: boolean; json?: boolean } = {},
  io: Io = console,
): number {
  const map = parseRepositoryMap(readFileSync(candidatePath, 'utf8'));
  const verification = verifyRepositoryMap(map, runtime.repositoryRoot);
  const target = repositoryMapPaths(runtime);
  const legacy =
    existsSync(target.view) &&
    !readFileSync(target.view, 'utf8').includes('generated from repository-map.yaml');
  const backup = join(target.projects, 'repository-map.legacy.md');
  const ready = verification.result === 'passed' && (!legacy || !existsSync(backup));
  const report = {
    ready,
    applied: false,
    repositories: map.repositories.length,
    relations: map.relations.length,
    legacyView: legacy,
    backup: legacy ? backup : null,
    misses: verification.misses,
  };
  if (apply) {
    if (!ready)
      throw new Error('Repository map migration is not ready; inspect the proposal first');
    assertRuntimeCanMutate(runtime);
    applyMigration(runtime, map, verification, legacy, backup);
    report.applied = true;
  }
  if (json) writeRepositoryMapJson(io, report);
  else {
    io.log(`Repository map migration: ${ready ? 'ready' : 'blocked'}`);
    io.log(`Repositories: ${report.repositories}; relations: ${report.relations}`);
    if (report.backup) io.log(`Legacy backup: ${report.backup}`);
    for (const miss of report.misses) io.error(`  ${miss}`);
  }
  return ready ? 0 : 1;
}
