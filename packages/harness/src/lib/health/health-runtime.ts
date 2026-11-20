import { verifyRuntimeIdentity } from '../../runtime.js';
import type { Runtime } from '../../types.js';
import { gitVersion } from '../filesystem/git.js';

export interface RuntimeHealthCheck {
  id: 'runtime';
  status: 'passed' | 'failed';
  message: string;
  details: string[];
}

export function runtimeHealth(): RuntimeHealthCheck {
  const [major = Number.NaN, minor = Number.NaN] = process.versions.node
    .split('.')
    .slice(0, 2)
    .map((part) => Number.parseInt(part, 10));
  const nodeCompatible = major > 22 || (major === 22 && minor >= 20);
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
