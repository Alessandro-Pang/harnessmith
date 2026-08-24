import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Io, Runtime } from '../types.js';
import { parseRepositoryMap } from './repository-map-format.js';

export function repositoryMapPaths(runtime: Runtime) {
  const projects = join(runtime.personalHome, 'projects');
  const state = join(runtime.installedHarness, 'state', 'repository-map');
  return {
    projects,
    canonical: join(projects, 'repository-map.yaml'),
    view: join(projects, 'repository-map.md'),
    state,
    verification: join(state, 'verification.json'),
  };
}

export function readCanonicalRepositoryMap(runtime: Runtime) {
  const path = repositoryMapPaths(runtime).canonical;
  if (!existsSync(path)) {
    throw new Error(`Canonical repository map is missing; run harness init personal: ${path}`);
  }
  return parseRepositoryMap(readFileSync(path, 'utf8'));
}

export function writeRepositoryMapJson(io: Io, value: unknown): void {
  io.log(JSON.stringify(value, null, 2));
}

export function assertGeneratedRepositoryMapView(path: string): void {
  if (!existsSync(path)) return;
  if (!readFileSync(path, 'utf8').includes('generated from repository-map.yaml')) {
    throw new Error(`Refusing to overwrite a legacy or user-managed repository map view: ${path}`);
  }
}
