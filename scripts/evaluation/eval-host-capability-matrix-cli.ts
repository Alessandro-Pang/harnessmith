import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { buildHostCapabilityMatrixReport } from './eval-host-capability-matrix.js';

function program(): Command {
  return new Command()
    .name('eval-host-capability-matrix')
    .description('Report candidate-bound multi-Host capability evaluation coverage')
    .requiredOption('--package-artifact <path>', 'exact candidate npm tarball')
    .option('--runs-dir <path>', 'validated real Host record directory')
    .option('--require-complete', 'fail unless every executable cell passed')
    .action((options: { packageArtifact: string; runsDir?: string; requireComplete?: boolean }) => {
      const report = buildHostCapabilityMatrixReport({
        candidateArtifact: options.packageArtifact,
        runsDirectory: options.runsDir,
      });
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      if (
        options.requireComplete &&
        report.cells.some(({ support, status }) => support === 'executable' && status !== 'passed')
      ) {
        process.exitCode = 1;
      }
    });
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  program()
    .parseAsync()
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
