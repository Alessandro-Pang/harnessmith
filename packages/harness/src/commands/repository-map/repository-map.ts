import { existsSync, readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { withExclusiveDirectoryLock } from '../../lib/filesystem/exclusive-lock.js';
import { atomicWrite } from '../../lib/filesystem/files.js';
import { withUserDataCoordinationLocks } from '../../lib/filesystem/user-data-lock.js';
import {
  maintainRepositoryMap,
  type RepositoryVerificationState,
  renderRepositoryMap,
  validateRepositoryMap,
  verifyRepositoryMap,
} from '../../lib/repository-map/repository-map.js';
import {
  assertGeneratedRepositoryMapView,
  readCanonicalRepositoryMap,
  repositoryMapPaths,
  writeRepositoryMapJson,
} from '../../lib/repository-map/repository-map-runtime.js';
import { assertRuntimeCanMutate } from '../../runtime.js';
import type { Io, Runtime } from '../../types.js';

export function repositoryMapCheck(
  runtime: Runtime,
  { json = false }: { json?: boolean } = {},
  io: Io = console,
): number {
  const path = repositoryMapPaths(runtime).canonical;
  if (!existsSync(path)) {
    const report = { valid: false, issues: [`Canonical repository map is missing: ${path}`] };
    if (json) writeRepositoryMapJson(io, report);
    else for (const issue of report.issues) io.error(issue);
    return 1;
  }
  let value: unknown;
  try {
    value = parse(readFileSync(path, 'utf8'));
  } catch (error) {
    const report = { valid: false, issues: [`Invalid repository map YAML: ${String(error)}`] };
    if (json) writeRepositoryMapJson(io, report);
    else for (const issue of report.issues) io.error(issue);
    return 1;
  }
  const report = validateRepositoryMap(value);
  if (json) writeRepositoryMapJson(io, report);
  else if (report.valid) io.log(`Repository map is valid: ${path}`);
  else for (const issue of report.issues) io.error(issue);
  return report.valid ? 0 : 1;
}

export function repositoryMapRender(
  runtime: Runtime,
  { write = false }: { write?: boolean } = {},
  io: Io = console,
): number {
  const content = renderRepositoryMap(readCanonicalRepositoryMap(runtime));
  if (!write) {
    io.log(content.trimEnd());
    return 0;
  }
  assertRuntimeCanMutate(runtime);
  const target = repositoryMapPaths(runtime);
  assertGeneratedRepositoryMapView(target.view);
  withUserDataCoordinationLocks([runtime.personalHome], [], () =>
    withExclusiveDirectoryLock(runtime.personalHome, 'Personal overlay', () =>
      atomicWrite(target.view, content),
    ),
  );
  io.log(`Rendered repository map: ${target.view}`);
  return 0;
}

export function repositoryMapVerify(
  runtime: Runtime,
  { record = false, json = false }: { record?: boolean; json?: boolean } = {},
  io: Io = console,
): number {
  const state = verifyRepositoryMap(readCanonicalRepositoryMap(runtime), runtime.repositoryRoot);
  if (record) {
    assertRuntimeCanMutate(runtime);
    const target = repositoryMapPaths(runtime);
    withUserDataCoordinationLocks([target.state], [], () =>
      withExclusiveDirectoryLock(target.state, 'Repository map state', () =>
        atomicWrite(target.verification, `${JSON.stringify(state, null, 2)}\n`),
      ),
    );
  }
  if (json) writeRepositoryMapJson(io, state);
  else {
    io.log(`Repository map verification: ${state.result}`);
    for (const miss of state.misses) io.error(`  ${miss}`);
  }
  return state.result === 'passed' ? 0 : 1;
}

function readVerification(runtime: Runtime): RepositoryVerificationState | null {
  const path = repositoryMapPaths(runtime).verification;
  if (!existsSync(path)) return null;
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as RepositoryVerificationState;
    if (value.version !== 1 || !Array.isArray(value.sources) || !Array.isArray(value.misses)) {
      throw new Error('unsupported verification state');
    }
    return value;
  } catch (error) {
    throw new Error(`Invalid repository map verification state: ${path}: ${String(error)}`);
  }
}

export function repositoryMapMaintain(
  runtime: Runtime,
  { json = false, maxAgeDays = 30 }: { json?: boolean; maxAgeDays?: number } = {},
  io: Io = console,
): number {
  if (!Number.isInteger(maxAgeDays) || maxAgeDays < 1 || maxAgeDays > 3650) {
    throw new Error(`Invalid max age days: ${maxAgeDays}`);
  }
  const report = maintainRepositoryMap(
    readCanonicalRepositoryMap(runtime),
    readVerification(runtime),
    runtime.repositoryRoot,
    new Date(),
    maxAgeDays,
  );
  if (json) writeRepositoryMapJson(io, report);
  else {
    io.log(`Stale repository-map sources: ${report.stale.length}`);
    for (const stale of report.stale) io.log(`  ${stale}`);
    io.log(`Missing repository-map sources: ${report.missing.length}`);
    for (const missing of report.missing) io.log(`  ${missing}`);
  }
  return report.stale.length === 0 && report.missing.length === 0 && report.withinBudget ? 0 : 1;
}
