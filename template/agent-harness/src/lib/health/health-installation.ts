import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { managedOutputWithinHome } from '../../runtime.js';
import { errorMessage, type Runtime } from '../../types.js';
import { digestPath } from '../filesystem/files.js';
import {
  installationIdentityHealth,
  isManagedInstallRecord,
  type ManagedInstallRecord,
} from './health-runtime.js';
import type { HealthCheck } from './health-types.js';

function managedInstallationHealth(runtime: Runtime): HealthCheck {
  const recordPath = join(runtime.harnessHome, '.harnessmith', 'install.json');
  if (!existsSync(recordPath))
    return {
      id: 'installation',
      status: 'failed',
      message: 'Installation record is missing',
      details: [recordPath],
    };
  let record: ManagedInstallRecord;
  try {
    const parsed: unknown = JSON.parse(readFileSync(recordPath, 'utf8'));
    if (!isManagedInstallRecord(parsed))
      throw new Error('managed installation record schema is invalid');
    record = parsed;
  } catch (error) {
    return {
      id: 'installation',
      status: 'failed',
      message: `Installation record is invalid: ${errorMessage(error)}`,
      details: [recordPath],
    };
  }
  if (
    record.schemaVersion !== 1 ||
    record.adapter !== runtime.hostAdapter ||
    !Array.isArray(record.outputs)
  ) {
    return {
      id: 'installation',
      status: 'failed',
      message: 'Installation record is incompatible',
      details: [recordPath],
    };
  }
  const expected = [...runtime.instructionFiles, runtime.installedHarness]
    .map((path) => resolve(path))
    .sort();
  const actual = record.outputs
    .map(({ path }) => (typeof path === 'string' ? resolve(path) : ''))
    .sort();
  if (expected.length !== actual.length || expected.some((path, index) => path !== actual[index])) {
    return {
      id: 'installation',
      status: 'failed',
      message: 'Installation record outputs do not match the host contract',
      details: [recordPath],
    };
  }
  const details: string[] = [];
  for (const output of record.outputs) {
    if (typeof output.path !== 'string' || typeof output.checksum !== 'string') {
      details.push('invalid managed output checksum record');
      continue;
    }
    if (!managedOutputWithinHome(runtime.harnessHome, output.path)) {
      details.push(`unsafe managed output: ${output.path}`);
      continue;
    }
    const path = resolve(output.path);
    try {
      const checksum = digestPath(path, {
        exclude: (relativePath) =>
          path === resolve(runtime.installedHarness) && relativePath.split(sep)[0] === 'state',
      });
      if (checksum === null) details.push(`missing managed output: ${path}`);
      else if (checksum !== output.checksum) details.push(`modified managed output: ${path}`);
    } catch (error) {
      details.push(`unreadable managed output: ${path}: ${errorMessage(error)}`);
    }
  }
  return {
    id: 'installation',
    status: details.length === 0 ? 'passed' : 'failed',
    message:
      details.length === 0
        ? 'Installation contract and managed checksums are valid'
        : 'Installation ownership or integrity check failed',
    ...(details.length > 0 ? { details } : {}),
  };
}

export function installationHealth(runtime: Runtime): HealthCheck {
  const identityFailure = installationIdentityHealth(runtime);
  if (identityFailure) return identityFailure;
  const manifestPath = join(runtime.installedHarness, 'manifest.json');
  const required = [
    ...runtime.instructionFiles,
    join(runtime.installedHarness, 'bin', 'harness.mjs'),
    manifestPath,
    join(runtime.personalHome, 'AGENTS.md'),
  ];
  const missing = required.filter((path) => !existsSync(path));
  if (missing.length > 0)
    return {
      id: 'installation',
      status: 'failed',
      message: `Installation is missing ${missing.length} required path(s)`,
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
  const testFixture = runtime.identityOverride === 'test-fixture' && runtime.hostAdapter === 'test';
  if (runtime.hostAdapter !== 'standalone' && !testFixture)
    return managedInstallationHealth(runtime);
  return { id: 'installation', status: 'passed', message: 'Installation contract available' };
}
