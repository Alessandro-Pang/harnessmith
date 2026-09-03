import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';

export const temporaryResourceMarkerName = '.harnessmith-temp-resource.json';
export const temporaryResourceLabel = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export type TemporaryResourceLifecycle =
  | 'process'
  | 'operation'
  | 'workstream'
  | 'retained-for-recovery';

export interface TemporaryResourceMarker {
  version: 1;
  resourceId: string;
  owner: string;
  purpose: string;
  lifecycle: TemporaryResourceLifecycle;
  pid: number;
  createdAt: string;
}

export function assertTemporaryResourceLabel(label: string, value: string): void {
  if (!temporaryResourceLabel.test(value)) {
    throw new Error(`${label} must match ${temporaryResourceLabel.source}: ${value}`);
  }
}

export function canonicalTemporaryDirectory(input: string): string {
  const path = realpathSync.native(resolve(input));
  const entry = lstatSync(path);
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    throw new Error(`Temporary resource root must be a real directory: ${path}`);
  }
  return path;
}

function markerIsValid(value: unknown): value is TemporaryResourceMarker {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const marker = value as Partial<TemporaryResourceMarker> & Record<string, unknown>;
  const keys = Object.keys(marker).sort();
  const expected = ['createdAt', 'lifecycle', 'owner', 'pid', 'purpose', 'resourceId', 'version'];
  return (
    JSON.stringify(keys) === JSON.stringify(expected) &&
    marker.version === 1 &&
    typeof marker.resourceId === 'string' &&
    /^[0-9a-f]{32}$/.test(marker.resourceId) &&
    typeof marker.owner === 'string' &&
    temporaryResourceLabel.test(marker.owner) &&
    typeof marker.purpose === 'string' &&
    temporaryResourceLabel.test(marker.purpose) &&
    ['process', 'operation', 'workstream', 'retained-for-recovery'].includes(
      String(marker.lifecycle),
    ) &&
    Number.isSafeInteger(marker.pid) &&
    Number(marker.pid) > 0 &&
    typeof marker.createdAt === 'string' &&
    Number.isFinite(Date.parse(marker.createdAt))
  );
}

export function readTemporaryResourceMarker(path: string): TemporaryResourceMarker {
  const entry = lstatSync(path);
  if (!entry.isFile() || entry.isSymbolicLink()) {
    throw new Error(`Temporary resource marker must be a regular file: ${path}`);
  }
  const value = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  if (!markerIsValid(value)) throw new Error(`Invalid temporary resource marker: ${path}`);
  return value;
}
