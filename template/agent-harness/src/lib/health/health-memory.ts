import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HealthCheck } from './health-types.js';
import type { MemoryRootKind } from '../memory/memory-autopilot-document-rules.js';
import {
  memoryMaintenanceReport,
  memoryMaintenanceWarnings,
} from '../memory/memory-maintenance.js';
import { resolveMemoryRoot } from '../memory/memory-path.js';
import { validateMemoryRoot } from '../memory/memory-validation.js';
import { errorMessage, type Io, type Runtime } from '../../types.js';

export function memoryHealth(
  id: string,
  root: string,
  today: string,
  requiredEntries: string[],
  rootKind: Exclude<MemoryRootKind, 'auto'>,
): HealthCheck {
  if (!existsSync(root))
    return { id, status: 'failed', message: `Memory root is missing: ${root}` };
  const missingEntries = requiredEntries.filter((name) => !existsSync(join(root, name)));
  if (missingEntries.length > 0)
    return {
      id,
      status: 'failed',
      message: `Required memory entries are missing: ${missingEntries.join(', ')}`,
      details: missingEntries.map((name) => join(root, name)),
    };
  const details: string[] = [];
  const capture: Io = {
    log: (message = '') => details.push(String(message)),
    error: (message = '') => details.push(String(message)),
  };
  try {
    validateMemoryRoot(root, capture, { quietSuccess: true, rootKind });
    const maintenance = memoryMaintenanceReport(root, today);
    if (maintenance.unindexed.length > 0)
      return {
        id,
        status: 'failed',
        message: `${maintenance.unindexed.length} active memory document(s) are unindexed`,
        details: maintenance.unindexed,
      };
    const warnings = memoryMaintenanceWarnings(maintenance);
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

export function projectMemoryHealth(
  runtime: Runtime,
  projectRoot: string,
  today: string,
): HealthCheck {
  const check = memoryHealth(
    'project-memory',
    resolveMemoryRoot(runtime, projectRoot),
    today,
    ['README.md', 'core.md'],
    'project',
  );
  if (check.status === 'failed') return check;
  const missingIgnoreRules: string[] = [];
  for (const name of ['.gitignore', '.ignore']) {
    const path = join(projectRoot, '.agent-docs', name);
    if (!(existsSync(path) && readFileSync(path, 'utf8').split(/\r?\n/).includes('*')))
      missingIgnoreRules.push(`missing project memory ignore rule: ${path}`);
  }
  if (missingIgnoreRules.length === 0) return check;
  return {
    id: 'project-memory',
    status: 'failed',
    message: 'Project memory ignore contract failed',
    details: missingIgnoreRules,
  };
}
