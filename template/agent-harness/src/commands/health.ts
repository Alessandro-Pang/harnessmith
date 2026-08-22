import { createHealthReport } from '../lib/health.js';
import type { Io, Runtime } from '../types.js';

export function health(
  runtime: Runtime,
  { project, json = false }: { project?: string; json?: boolean } = {},
  io: Io = console,
): number {
  const report = createHealthReport(runtime, project);
  if (json) io.log(JSON.stringify(report, null, 2));
  else {
    for (const check of report.checks) {
      io.log(`${check.status.toUpperCase()} ${check.id}: ${check.message}`);
      for (const detail of check.details || []) io.log(`  ${detail}`);
    }
    io.log(report.healthy ? 'Health passed' : 'Health failed');
  }
  return report.healthy ? 0 : 1;
}
