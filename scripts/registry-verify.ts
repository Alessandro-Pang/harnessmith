import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command, InvalidArgumentError } from 'commander';
import { verifyRegistryPackage } from './registry-verification.js';
import { RegistryVerificationFailure } from './registry-verification-types.js';

function integer(value: string, minimum: number): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new InvalidArgumentError(
      minimum === 0 ? 'must be a non-negative integer' : 'must be a positive integer',
    );
  }
  return parsed;
}

async function main(): Promise<void> {
  const program = new Command()
    .name('registry-verify')
    .requiredOption('--package <name>', 'exact npm package name')
    .requiredOption('--version <version>', 'exact npm package version')
    .requiredOption('--expected-artifact <path>', 'exact locally published npm tarball')
    .requiredOption('--evidence-file <path>', 'machine-readable verification output')
    .option(
      '--max-attempts <count>',
      'bounded registry visibility attempts',
      (value) => integer(value, 1),
      6,
    )
    .option(
      '--retry-delay-ms <milliseconds>',
      'delay between visibility attempts',
      (value) => integer(value, 0),
      10_000,
    )
    .option('--require-provenance', 'require npm provenance metadata')
    .requiredOption('--json', 'write the verification report as JSON');
  program.parse();
  const options = program.opts<{
    package: string;
    version: string;
    expectedArtifact: string;
    evidenceFile: string;
    maxAttempts: number;
    retryDelayMs: number;
    requireProvenance?: boolean;
  }>();
  const report = await verifyRegistryPackage({
    packageName: options.package,
    version: options.version,
    expectedArtifact: options.expectedArtifact,
    evidenceFile: options.evidenceFile,
    maxAttempts: options.maxAttempts,
    retryDelayMs: options.retryDelayMs,
    requireProvenance: options.requireProvenance === true,
  });
  process.stdout.write(`${JSON.stringify(report)}\n`);
}

const entry = process.argv[1] ? resolve(process.argv[1]) : '';
if (entry === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    if (error instanceof RegistryVerificationFailure) console.error(JSON.stringify(error.report));
    else console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
