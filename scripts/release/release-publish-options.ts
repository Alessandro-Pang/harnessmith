import { Command, InvalidArgumentError } from 'commander';

export interface ReleaseCliOptions {
  acceptEvalRisk?: string;
  access?: string;
  dryRun?: boolean;
  packageArtifact?: string;
  prepareOnly?: boolean;
  provenance?: boolean;
  stateDir?: string;
  tag?: string;
}

export function releaseOptions(args: string[]): ReleaseCliOptions {
  let packageArtifactSeen = false;
  const packageArtifact = (value: string): string => {
    if (packageArtifactSeen) throw new InvalidArgumentError('may only be specified once');
    packageArtifactSeen = true;
    return value;
  };
  const command = new Command()
    .name('release:publish')
    .exitOverride()
    .configureOutput({ writeErr: () => undefined })
    .option('--package-artifact <path>', 'exact candidate npm tarball', packageArtifact)
    .option('--state-dir <path>', 'persistent private release state directory')
    .option('--prepare-only', 'run checks and preserve the verified snapshot without publishing')
    .option('--dry-run', 'ask npm to simulate publication')
    .option('--provenance', 'ask npm to publish provenance')
    .option('--tag <tag>', 'npm distribution tag')
    .option('--access <access>', 'npm access level')
    .option('--accept-eval-risk <path>', 'explicit user-authorized Host Eval risk acceptance JSON');
  try {
    command.parse(args, { from: 'user' });
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error));
  }
  return command.opts<ReleaseCliOptions>();
}
