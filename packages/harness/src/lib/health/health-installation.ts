import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { errorMessage, type Runtime } from '../../types.js';
import { installationIdentityHealth } from './health-runtime.js';
import type { HealthCheck } from './health-types.js';

/**
 * Read-only check of the bundled standalone package contract: the skill manifest and
 * bundled CLI entry inside the current npm package, plus the personal AGENTS.md at the
 * user-selected rules root. This does not prove any Host instruction file or installed
 * skill state; those belong to the outer installer and the real Host.
 */
export function installationHealth(runtime: Runtime): HealthCheck {
  const identityFailure = installationIdentityHealth(runtime);
  if (identityFailure) return identityFailure;
  const manifestPath = join(runtime.harnessRoot, 'manifest.json');
  const required = [
    join(runtime.distributionRoot, 'dist', 'harness.mjs'),
    manifestPath,
    join(runtime.personalHome, 'AGENTS.md'),
  ];
  const missing = required.filter((path) => !existsSync(path));
  if (missing.length > 0)
    return {
      id: 'installation',
      status: 'failed',
      message: `Installation has ${missing.length} invalid required path(s)`,
      details: missing,
    };
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      schemaVersion?: number;
      memorySchemaVersion?: number;
    };
    if (manifest.schemaVersion !== 3 || manifest.memorySchemaVersion !== 1)
      return {
        id: 'installation',
        status: 'failed',
        message: 'Installation schema is incompatible',
      };
  } catch (error) {
    return {
      id: 'installation',
      status: 'failed',
      message: `Installation manifest is invalid: ${errorMessage(error)}`,
    };
  }
  return { id: 'installation', status: 'passed', message: 'Standalone package contract available' };
}
