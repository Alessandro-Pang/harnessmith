import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { containsAdoptSecret } from '../adoption/adopt-secret.js';
import { atomicWrite } from '../shared/files.js';
import {
  type PortableConfigBundle,
  type PortableConfigExclusion,
  type PortableConfigResource,
  parsePortableConfigBundle,
  portableBundleDigest,
  portableConfigExcludedCategories,
  portableConfigPaths,
  portableDigest,
} from './portable-config-contract.js';
import { restoreSnapshots, snapshotFiles } from '../installation/records.js';
import { assertSafePath, canonicalPath } from '../shared/safe-path.js';
import { errorMessage, HarnessmithError } from '../shared/types.js';
import { withUserDataCoordinationLocks } from '../installation/user-data-lock.js';

export interface PortableConfigImportChange {
  path: (typeof portableConfigPaths)[number];
  action: 'create' | 'already-present' | 'conflict';
  sourceDigest: string;
  targetDigest: string | null;
}

export interface PortableConfigImportPlan {
  version: 1;
  action: 'import';
  schemaVersion: 1;
  rootKind: 'personal-overlay';
  proposalId: string;
  applied: boolean;
  rollback: 'snapshot-restore';
  changes: PortableConfigImportChange[];
}

function personalRoot(env: NodeJS.ProcessEnv): string {
  return canonicalPath(env.HARNESS_PERSONAL_HOME || join(env.HOME || homedir(), '.agent-harness'));
}

function regularFile(path: string, context: string) {
  const entry = lstatSync(path);
  if (entry.isSymbolicLink()) {
    throw new HarnessmithError('UNSAFE_PATH', `${context} is a symbolic link`, 3);
  }
  if (!entry.isFile()) throw new HarnessmithError('INTEGRITY_ERROR', `${context} is not a file`, 3);
  return entry;
}

function readUtf8(path: string): string {
  const buffer = readFileSync(path);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch (error) {
    throw new HarnessmithError('INTEGRITY_ERROR', 'Portable config file is not valid UTF-8', 3, {
      cause: error,
    });
  }
}

export function createPortableConfigBundle({
  env = process.env,
}: {
  env?: NodeJS.ProcessEnv;
} = {}) {
  const root = personalRoot(env);
  const resources: PortableConfigResource[] = [];
  const exclusions: PortableConfigExclusion[] = [];
  for (const relative of portableConfigPaths) {
    const path = join(root, relative);
    if (!existsSync(path)) continue;
    assertSafePath(root, path);
    const entry = regularFile(path, 'Portable config source');
    if (entry.size > 256 * 1024) {
      exclusions.push({ path: relative, reasonCode: 'FILE_BUDGET_EXCEEDED' });
      continue;
    }
    const content = readUtf8(path);
    if (containsAdoptSecret(content)) {
      exclusions.push({ path: relative, reasonCode: 'SECRET_DETECTED' });
      continue;
    }
    resources.push({ path: relative, encoding: 'utf8', digest: portableDigest(content), content });
  }
  const body = {
    schemaVersion: 1,
    kind: 'harnessmith-portable-config',
    rootKind: 'personal-overlay',
    collectionResult: exclusions.length > 0 ? ('partial' as const) : ('complete' as const),
    resources,
    exclusions,
    excludedCategories: portableConfigExcludedCategories,
  } as const;
  return { ...body, bundleDigest: portableBundleDigest(body) };
}

export function writePortableConfigBundle(path: string, bundle: PortableConfigBundle): void {
  parsePortableConfigBundle(bundle);
  const target = resolve(path);
  if (existsSync(target)) {
    regularFile(target, 'Portable config output');
    throw new HarnessmithError('SAFETY_CONFLICT', 'Portable config output already exists', 3);
  }
  atomicWrite(target, `${JSON.stringify(bundle, null, 2)}\n`, 0o600);
}

function readBundle(path: string): PortableConfigBundle {
  const input = resolve(path);
  const entry = regularFile(input, 'Portable config input');
  if (entry.size > 1024 * 1024) {
    throw new HarnessmithError('INTEGRITY_ERROR', 'Portable config input exceeds byte budget', 3);
  }
  try {
    return parsePortableConfigBundle(JSON.parse(readUtf8(input)));
  } catch (error) {
    if (error instanceof HarnessmithError) throw error;
    throw new HarnessmithError('INTEGRITY_ERROR', 'Portable config input is not valid JSON', 3, {
      cause: error,
    });
  }
}

function importPlan(
  bundle: PortableConfigBundle,
  env: NodeJS.ProcessEnv,
): PortableConfigImportPlan {
  const root = personalRoot(env);
  const changes = bundle.resources.map((resource) => {
    const target = join(root, resource.path);
    assertSafePath(root, target);
    if (!existsSync(target)) {
      return {
        path: resource.path,
        action: 'create' as const,
        sourceDigest: resource.digest,
        targetDigest: null,
      };
    }
    const entry = regularFile(target, 'Portable config target');
    if (entry.size > 256 * 1024) {
      return {
        path: resource.path,
        action: 'conflict' as const,
        sourceDigest: resource.digest,
        targetDigest: null,
      };
    }
    const targetDigest = portableDigest(readUtf8(target));
    return {
      path: resource.path,
      action:
        targetDigest === resource.digest ? ('already-present' as const) : ('conflict' as const),
      sourceDigest: resource.digest,
      targetDigest,
    };
  });
  const proposalId = portableDigest(JSON.stringify({ bundleDigest: bundle.bundleDigest, changes }));
  return {
    version: 1,
    action: 'import',
    schemaVersion: bundle.schemaVersion,
    rootKind: bundle.rootKind,
    proposalId,
    applied: false,
    rollback: 'snapshot-restore',
    changes,
  };
}

export function planPortableConfigImport(
  bundlePath: string,
  { env = process.env }: { env?: NodeJS.ProcessEnv } = {},
): PortableConfigImportPlan {
  return importPlan(readBundle(bundlePath), env);
}

export function applyPortableConfigImport(
  bundlePath: string,
  proposalId: string,
  {
    env = process.env,
    afterWrite,
  }: {
    env?: NodeJS.ProcessEnv;
    afterWrite?: (event: { index: number; path: string }) => void;
  } = {},
): PortableConfigImportPlan {
  const bundle = readBundle(bundlePath);
  const root = personalRoot(env);
  return withUserDataCoordinationLocks([root], () => {
    const plan = importPlan(bundle, env);
    if (plan.proposalId !== proposalId) {
      throw new HarnessmithError('STATE_CONFLICT', 'Portable config import proposal changed', 3);
    }
    if (plan.changes.some(({ action }) => action === 'conflict')) {
      throw new HarnessmithError(
        'SAFETY_CONFLICT',
        'Portable config target conflict requires the explicit adopt flow',
        3,
      );
    }
    const paths = bundle.resources.map(({ path }) => join(root, path));
    const snapshots = snapshotFiles(paths.map((path) => ({ path })));
    try {
      bundle.resources.forEach((resource, index) => {
        if (plan.changes[index]?.action === 'already-present') return;
        const target = paths[index];
        assertSafePath(root, target);
        atomicWrite(target, resource.content);
        afterWrite?.({ index, path: resource.path });
      });
      return { ...plan, applied: true };
    } catch (error) {
      try {
        restoreSnapshots(snapshots);
      } catch (rollbackError) {
        throw new Error(
          `Portable config import failed and rollback was incomplete: ${errorMessage(error)}; rollback: ${errorMessage(rollbackError)}`,
          { cause: error instanceof Error ? error : undefined },
        );
      }
      throw error;
    }
  });
}
