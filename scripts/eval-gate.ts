import { Command, InvalidArgumentError } from 'commander';
import { gateEvaluationRecords, validateEvaluationRecords } from './eval-contract.js';
import { evaluationFingerprint, releaseArtifactPath } from './eval-fingerprint.js';
import { EvaluationGateError } from './eval-gate-failure.js';

function positiveNumber(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new InvalidArgumentError('must be a positive number');
  }
  return parsed;
}

function main(): void {
  const program = new Command()
    .name('eval-gate')
    .description('Validate maintainer-attested Harness host evaluation evidence')
    .showHelpAfterError();

  program
    .command('fingerprint')
    .description('fingerprint the exact release candidate')
    .requiredOption('--json', 'write the fingerprint as JSON')
    .option('--package-artifact <path>', 'exact candidate npm tarball')
    .action(({ packageArtifact }: { packageArtifact?: string }) => {
      process.stdout.write(
        `${JSON.stringify(evaluationFingerprint(releaseArtifactPath(packageArtifact)), null, 2)}\n`,
      );
    });

  program
    .command('validate')
    .description('validate host evaluation record structure and artifacts')
    .option('--runs-dir <path>', 'host evaluation records directory')
    .action(({ runsDir }: { runsDir?: string }) => {
      const count = validateEvaluationRecords({ runsDirectory: runsDir }).length;
      console.log(
        `Validated ${count} maintainer-attested host evaluation record structure${count === 1 ? '' : 's'}`,
      );
    });

  program
    .command('gate')
    .description('require a fresh passing host and scenario matrix')
    .option('--runs-dir <path>', 'host evaluation records directory')
    .option('--package-artifact <path>', 'exact candidate npm tarball')
    .option('--max-age-days <days>', 'maximum record age', positiveNumber, 30)
    .option('--json', 'write the gate result as JSON')
    .action(
      ({
        json,
        maxAgeDays,
        packageArtifact,
        runsDir,
      }: {
        json?: boolean;
        maxAgeDays: number;
        packageArtifact?: string;
        runsDir?: string;
      }) => {
        const result = gateEvaluationRecords({
          maxAgeDays,
          packageArtifact,
          runsDirectory: runsDir,
        });
        if (json) process.stdout.write(`${JSON.stringify(result)}\n`);
        else
          console.log(
            `Maintainer-attested Host evaluation structure gate passed with ${result.coverageCount} fresh matrix records`,
          );
      },
    );

  program.parse();
}

try {
  main();
} catch (error) {
  if (error instanceof EvaluationGateError && process.argv.includes('--json')) {
    process.stderr.write(`${JSON.stringify(error.result)}\n`);
  } else {
    console.error(error instanceof Error ? error.message : String(error));
  }
  process.exitCode = 1;
}
