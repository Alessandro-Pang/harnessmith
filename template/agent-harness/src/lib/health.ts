import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { calendarDate, managedOutputWithinHome } from '../runtime.js';
import { errorMessage, type Io, type Runtime } from '../types.js';
import { digestPath } from './files.js';
import { installationIdentityHealth, runtimeHealth } from './health-runtime.js';
import { memoryMaintenanceReport } from './memory-maintenance.js';
import { resolveMemoryRoot } from './memory-path.js';
import { validateMemoryRoot } from './memory-validation.js';
import { projectSnapshot } from './project.js';

type HealthStatus = 'passed' | 'warning' | 'failed';
type HealthCheck = { id: string; status: HealthStatus; message: string; details?: string[] };
export type HealthReport = { version: 1; healthy: boolean; checks: HealthCheck[] };
type ManagedRecord = {
  schemaVersion?: number;
  adapter?: string;
  outputs?: Array<{ path?: string; checksum?: string }>;
};

function managedInstallationHealth(runtime: Runtime): HealthCheck {
  const recordPath = join(runtime.harnessHome, '.harnessmith', 'install.json');
  if (!existsSync(recordPath)) {
    return {
      id: 'installation',
      status: 'failed',
      message: 'Installation record is missing',
      details: [recordPath],
    };
  }
  let record: ManagedRecord;
  try {
    record = JSON.parse(readFileSync(recordPath, 'utf8')) as ManagedRecord;
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

function installationHealth(runtime: Runtime): HealthCheck {
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
  if (missing.length > 0) {
    return {
      id: 'installation',
      status: 'failed',
      message: `Installation is missing ${missing.length} required path(s)`,
      details: missing,
    };
  }
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      schemaVersion?: number;
      memorySchemaVersion?: number;
    };
    if (manifest.schemaVersion !== 3 || manifest.memorySchemaVersion !== 1) {
      return {
        id: 'installation',
        status: 'failed',
        message: 'Installation schema is incompatible',
      };
    }
  } catch (error) {
    return {
      id: 'installation',
      status: 'failed',
      message: `Installation manifest is invalid: ${errorMessage(error)}`,
    };
  }
  const testFixture = runtime.identityOverride === 'test-fixture' && runtime.hostAdapter === 'test';
  if (runtime.hostAdapter !== 'standalone' && !testFixture) {
    return managedInstallationHealth(runtime);
  }
  return { id: 'installation', status: 'passed', message: 'Installation contract available' };
}

function projectMemoryHealth(runtime: Runtime, projectRoot: string, today: string): HealthCheck {
  const check = memoryHealth('project-memory', resolveMemoryRoot(runtime, projectRoot), today, [
    'README.md',
    'core.md',
  ]);
  if (check.status === 'failed') return check;
  const missingIgnoreRules: string[] = [];
  for (const name of ['.gitignore', '.ignore']) {
    const path = join(projectRoot, name);
    const hasRule =
      existsSync(path) && readFileSync(path, 'utf8').split(/\r?\n/).includes('/.agent-docs/');
    if (!hasRule) missingIgnoreRules.push(`missing project memory ignore rule: ${path}`);
  }
  if (missingIgnoreRules.length === 0) return check;
  return {
    id: 'project-memory',
    status: 'failed',
    message: 'Project memory ignore contract failed',
    details: missingIgnoreRules,
  };
}

function memoryHealth(
  id: string,
  root: string,
  today: string,
  requiredEntries: string[],
): HealthCheck {
  if (!existsSync(root))
    return { id, status: 'failed', message: `Memory root is missing: ${root}` };
  const missingEntries = requiredEntries.filter((name) => !existsSync(join(root, name)));
  if (missingEntries.length > 0) {
    return {
      id,
      status: 'failed',
      message: `Required memory entries are missing: ${missingEntries.join(', ')}`,
      details: missingEntries.map((name) => join(root, name)),
    };
  }
  const details: string[] = [];
  const capture: Io = {
    log(message: unknown = '') {
      details.push(String(message));
    },
    error(message: unknown = '') {
      details.push(String(message));
    },
  };
  try {
    validateMemoryRoot(root, capture, { quietSuccess: true });
    const maintenance = memoryMaintenanceReport(root, today);
    if (maintenance.unindexed.length > 0) {
      return {
        id,
        status: 'failed',
        message: `${maintenance.unindexed.length} active memory document(s) are unindexed`,
        details: maintenance.unindexed,
      };
    }
    const warnings = [
      ...maintenance.expiredWorking.map((path) => `expired: ${path}`),
      ...maintenance.closed.map((path) => `archive candidate: ${path}`),
    ];
    return {
      id,
      status: warnings.length > 0 ? 'warning' : 'passed',
      message:
        warnings.length > 0
          ? 'Memory is valid with maintenance candidates'
          : 'Memory is valid and indexed',
      ...(warnings.length > 0 ? { details: warnings } : {}),
    };
  } catch (error) {
    return {
      id,
      status: 'failed',
      message: errorMessage(error),
      ...(details.length > 0 ? { details } : {}),
    };
  }
}

export function createHealthReport(runtime: Runtime, project?: string): HealthReport {
  const today = calendarDate(runtime);
  const checks: HealthCheck[] = [
    runtimeHealth(),
    installationHealth(runtime),
    memoryHealth('global-memory', runtime.memoryHome, today, [
      'README.md',
      'core.md',
      'profile.md',
    ]),
  ];
  if (project) {
    const snapshot = projectSnapshot(project);
    checks.push(projectMemoryHealth(runtime, snapshot.root, today));
  }
  return {
    version: 1,
    healthy: checks.every((check) => check.status !== 'failed'),
    checks,
  };
}
