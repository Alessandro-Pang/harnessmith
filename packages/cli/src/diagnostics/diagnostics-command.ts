import type { Adapter, CliOptions, Io } from '../shared/types.js';
import { createDiagnosticsReport } from './diagnostics.js';

export function executeDiagnostics(
  adapters: Adapter[],
  options: CliOptions,
  { env, io }: { env: NodeJS.ProcessEnv; io: Io },
): number {
  const report = createDiagnosticsReport(adapters, { env, project: options.project });
  if (options.json) io.log(JSON.stringify(report));
  else {
    io.log(`Diagnostics collection: ${report.collectionResult}`);
    io.log('No report was uploaded or persisted by Harnessmith.');
    for (const adapter of report.adapters) {
      io.log(`  ${adapter.adapter}  installation=${adapter.installation.status}`);
      for (const subsystem of adapter.subsystems) {
        io.log(`    ${subsystem.id}  ${subsystem.status}  ${subsystem.reasonCode}`);
      }
    }
  }
  return report.collectionResult === 'complete' ? 0 : 1;
}
