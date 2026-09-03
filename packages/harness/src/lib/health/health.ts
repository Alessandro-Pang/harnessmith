import { calendarDate } from '../../runtime.js';
import type { Runtime } from '../../types.js';
import { auditHealth } from './health-audit.js';
import { installationHealth } from './health-installation.js';
import { memoryHealth, projectMemoryHealth } from './health-memory.js';
import { runtimeHealth } from './health-runtime.js';
import type { HealthCheck, HealthReport } from './health-types.js';

export function createHealthReport(runtime: Runtime, project?: string): HealthReport {
  const today = calendarDate(runtime);
  const checks: HealthCheck[] = [
    runtimeHealth(),
    installationHealth(runtime),
    memoryHealth(
      'global-memory',
      runtime.memoryHome,
      today,
      ['README.md', 'core.md', 'profile.md'],
      'global',
    ),
    auditHealth(runtime),
  ];
  if (project) checks.push(projectMemoryHealth(runtime, project, today));
  return { version: 1, healthy: checks.every((check) => check.status !== 'failed'), checks };
}
