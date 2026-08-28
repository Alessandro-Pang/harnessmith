import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { scanTemporaryResourceRoots } from '../src/temporary-resource.js';

export function temporaryResourceReport(args: string[]): void {
  const program = new Command()
    .name('temp-resources')
    .description('report managed Harnesssmith temporary resources without deleting them')
    .option('--root <path>', 'temporary root to scan')
    .option('--json', 'write a machine-readable dry-run report')
    .allowExcessArguments(false)
    .exitOverride();
  program.parse(args, { from: 'user' });
  const options = program.opts<{ root?: string; json?: boolean }>();
  const report = scanTemporaryResourceRoots({ roots: options.root ? [options.root] : undefined });
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report)}\n`);
    return;
  }
  console.log(
    `Managed temporary resource dry-run: ${report.resources.length} resource(s) under ${report.roots.join(', ')}`,
  );
  for (const resource of report.resources) {
    console.log(
      `${resource.active ? 'active' : 'inactive'} ${resource.kind} ${resource.lifecycle} ${resource.owner}/${resource.purpose} ${resource.sizeBytes}B ${resource.path}`,
    );
  }
  for (const skipped of report.skipped) {
    console.log(`skipped ${skipped.path}: ${skipped.reason}`);
  }
  if (report.truncated) console.log('scan truncated by the entry budget');
}

const entry = process.argv[1] ? resolve(process.argv[1]) : '';
if (entry === fileURLToPath(import.meta.url)) {
  try {
    temporaryResourceReport(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
