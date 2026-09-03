import { verifyRuntimeIdentity } from '../../runtime.js';
import type { Runtime } from '../../types.js';
import { gitVersion } from '../filesystem/git.js';

export interface RuntimeHealthCheck {
  id: 'runtime';
  status: 'passed' | 'failed';
  message: string;
  details: string[];
}

export interface ManagedInstallRecord {
  schemaVersion?: number;
  adapter?: string;
  outputs?: Array<{ path?: string; checksum?: string }>;
}

function isManagedInstallOutput(value: unknown): value is { path?: string; checksum?: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const output = value as Record<string, unknown>;
  return (
    (output.path === undefined || typeof output.path === 'string') &&
    (output.checksum === undefined || typeof output.checksum === 'string')
  );
}

export function isManagedInstallRecord(value: unknown): value is ManagedInstallRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    (record.schemaVersion === undefined || typeof record.schemaVersion === 'number') &&
    (record.adapter === undefined || typeof record.adapter === 'string') &&
    (record.outputs === undefined ||
      (Array.isArray(record.outputs) && record.outputs.every(isManagedInstallOutput)))
  );
}

export function runtimeHealth(): RuntimeHealthCheck {
  const [major, minor] = process.versions.node
    .split('.')
    .slice(0, 2)
    .map((part) => Number.parseInt(part, 10));
  const nodeCompatible = major > 24 || (major === 24 && minor >= 12);
  const git = gitVersion();
  const details = [`Node.js ${process.versions.node}`, git || 'Git unavailable'];
  return {
    id: 'runtime',
    status: nodeCompatible && git ? 'passed' : 'failed',
    message:
      nodeCompatible && git ? 'Runtime prerequisites available' : 'Runtime prerequisites failed',
    details,
  };
}

export function installationIdentityHealth(
  runtime: Runtime,
): { id: 'installation'; status: 'failed'; message: string; details?: string[] } | null {
  const identity = verifyRuntimeIdentity(runtime);
  if (identity.valid) return null;
  return {
    id: 'installation',
    status: 'failed',
    message: identity.message,
    ...(identity.details ? { details: identity.details } : {}),
  };
}
