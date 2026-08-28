import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  assertTemporaryResourceLabel,
  canonicalTemporaryDirectory,
  readTemporaryResourceMarker,
  type TemporaryResourceLifecycle,
  type TemporaryResourceMarker,
  temporaryResourceMarkerName,
} from './temporary-resource-marker.js';
import { errorMessage } from './types.js';

export type { TemporaryResourceLifecycle } from './temporary-resource-marker.js';
export type { TemporaryResourceAggregateReport } from './temporary-resource-roots.js';
export { scanTemporaryResourceRoots } from './temporary-resource-roots.js';
export type {
  TemporaryResourceReportItem,
  TemporaryResourceScanReport,
} from './temporary-resource-scan.js';
export { scanTemporaryResources } from './temporary-resource-scan.js';

export interface TemporaryWorkspaceOptions {
  base?: string;
  owner: string;
  purpose: string;
  lifecycle: TemporaryResourceLifecycle;
  retainOnFailure?: boolean;
}

export interface TemporaryWorkspace {
  path: string;
  markerPath: string;
  marker: Readonly<TemporaryResourceMarker>;
  identity: { dev: number; ino: number };
  retainOnFailure: boolean;
}

export class TemporaryResourceCleanupError extends Error {
  readonly retainedPath: string;

  constructor(message: string, retainedPath: string, cause?: unknown) {
    const path = resolve(retainedPath);
    super(`${message}; retained path: ${path}`, {
      cause: cause instanceof Error ? cause : undefined,
    });
    this.name = 'TemporaryResourceCleanupError';
    this.retainedPath = path;
  }
}

export class TemporaryResourceRecoveryError extends Error {
  readonly retainedPath: string;

  constructor(message: string, retainedPath: string, cause?: unknown) {
    const path = resolve(retainedPath);
    super(`${message}; recovery data retained at: ${path}`, {
      cause: cause instanceof Error ? cause : undefined,
    });
    this.name = 'TemporaryResourceRecoveryError';
    this.retainedPath = path;
  }
}

export function createTemporaryWorkspace(options: TemporaryWorkspaceOptions): TemporaryWorkspace {
  assertTemporaryResourceLabel('Temporary resource owner', options.owner);
  assertTemporaryResourceLabel('Temporary resource purpose', options.purpose);
  const base = canonicalTemporaryDirectory(options.base ?? tmpdir());
  const path = mkdtempSync(join(base, `harnessmith-${options.purpose}-`));
  const markerPath = join(path, temporaryResourceMarkerName);
  const marker: TemporaryResourceMarker = {
    version: 1,
    resourceId: randomBytes(16).toString('hex'),
    owner: options.owner,
    purpose: options.purpose,
    lifecycle: options.lifecycle,
    pid: process.pid,
    createdAt: new Date().toISOString(),
  };
  try {
    chmodSync(path, 0o700);
    writeFileSync(markerPath, `${JSON.stringify(marker)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    const identity = statSync(path);
    return {
      path,
      markerPath,
      marker,
      identity: { dev: identity.dev, ino: identity.ino },
      retainOnFailure: options.retainOnFailure === true,
    };
  } catch (error) {
    try {
      rmSync(path, { recursive: true, force: true });
    } catch (cleanupError) {
      throw new TemporaryResourceCleanupError(
        `Temporary workspace creation failed: ${errorMessage(error)}; cleanup failed: ${errorMessage(cleanupError)}`,
        path,
        error,
      );
    }
    throw error;
  }
}

export function disposeTemporaryWorkspace(workspace: TemporaryWorkspace): void {
  try {
    const entry = lstatSync(workspace.path);
    if (
      !entry.isDirectory() ||
      entry.isSymbolicLink() ||
      entry.dev !== workspace.identity.dev ||
      entry.ino !== workspace.identity.ino
    ) {
      throw new Error(`Temporary workspace identity changed: ${workspace.path}`);
    }
    const marker = readTemporaryResourceMarker(workspace.markerPath);
    if (JSON.stringify(marker) !== JSON.stringify(workspace.marker)) {
      throw new Error(`Temporary workspace marker identity changed: ${workspace.markerPath}`);
    }
    rmSync(workspace.path, { recursive: true, force: false });
    if (existsSync(workspace.path)) {
      throw new Error(`Temporary workspace still exists after cleanup: ${workspace.path}`);
    }
  } catch (error) {
    throw new TemporaryResourceCleanupError(
      `Temporary workspace cleanup failed: ${errorMessage(error)}`,
      workspace.path,
      error,
    );
  }
}

export function withTemporaryWorkspace<T>(
  options: TemporaryWorkspaceOptions,
  operation: (workspace: TemporaryWorkspace) => T,
): T {
  const workspace = createTemporaryWorkspace(options);
  let result: T;
  try {
    result = operation(workspace);
  } catch (error) {
    if (workspace.retainOnFailure) {
      throw new TemporaryResourceRecoveryError(
        `Temporary workspace operation failed: ${errorMessage(error)}`,
        workspace.path,
        error,
      );
    }
    try {
      disposeTemporaryWorkspace(workspace);
    } catch (cleanupError) {
      throw new TemporaryResourceRecoveryError(
        `Temporary workspace operation failed: ${errorMessage(error)}; cleanup failed: ${errorMessage(cleanupError)}`,
        workspace.path,
        error,
      );
    }
    throw error;
  }
  disposeTemporaryWorkspace(workspace);
  return result;
}
