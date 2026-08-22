import { chmodSync, constants, copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command, InvalidArgumentError } from 'commander';
import { execaSync } from 'execa';
import { evaluationFingerprint, releaseArtifactPath } from './eval-fingerprint.js';

interface ReleaseResult {
  status: number | null;
  signal: string | null;
  error?: Error;
}

interface ReleaseOptions {
  env: NodeJS.ProcessEnv;
  stdio: 'inherit';
}

export type ReleaseRunner = (
  executable: string,
  args: string[],
  options: ReleaseOptions,
) => ReleaseResult;

const defaultRunner: ReleaseRunner = (executable, args, options) => {
  const result = execaSync(executable, args, {
    env: options.env,
    reject: false,
    stdio: options.stdio,
  });
  return {
    status: result.exitCode ?? null,
    signal: result.signal ?? null,
    error: result.failed
      ? new Error(result.shortMessage ?? result.message ?? 'subprocess failed')
      : undefined,
  };
};

function snapshotArtifact(source: string): { path: string; cleanup: () => void } {
  const directory = mkdtempSync(join(tmpdir(), 'harnessmith-release-'));
  const path = join(directory, basename(source));
  try {
    copyFileSync(source, path, constants.COPYFILE_EXCL);
    chmodSync(path, 0o400);
  } catch (error) {
    rmSync(directory, { force: true, recursive: true });
    throw error;
  }
  return {
    path,
    cleanup: () => rmSync(directory, { force: true, recursive: true }),
  };
}

interface ReleaseCliOptions {
  access?: string;
  dryRun?: boolean;
  packageArtifact?: string;
  provenance?: boolean;
  tag?: string;
}

function releaseOptions(args: string[]): ReleaseCliOptions {
  let packageArtifactSeen = false;
  const packageArtifact = (value: string): string => {
    if (packageArtifactSeen) {
      throw new InvalidArgumentError('may only be specified once');
    }
    packageArtifactSeen = true;
    return value;
  };
  const command = new Command()
    .name('release:publish')
    .exitOverride()
    .configureOutput({ writeErr: () => undefined })
    .option('--package-artifact <path>', 'exact candidate npm tarball', packageArtifact)
    .option('--dry-run', 'ask npm to simulate publication')
    .option('--provenance', 'ask npm to publish provenance')
    .option('--tag <tag>', 'npm distribution tag')
    .option('--access <access>', 'npm access level');
  try {
    command.parse(args, { from: 'user' });
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error));
  }
  return command.opts<ReleaseCliOptions>();
}

function publishArguments(options: ReleaseCliOptions): string[] {
  return [
    ...(options.dryRun ? ['--dry-run'] : []),
    ...(options.provenance ? ['--provenance'] : []),
    ...(options.tag ? ['--tag', options.tag] : []),
    ...(options.access ? ['--access', options.access] : []),
  ];
}

function checkedRun(
  label: string,
  executable: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  runner: ReleaseRunner,
): void {
  const result = runner(executable, args, { env, stdio: 'inherit' });
  if (result.status !== 0) {
    const reason = result.error?.message || result.signal || `exit ${String(result.status)}`;
    throw new Error(`${label} failed: ${reason}`);
  }
}

export function releaseCandidate(args: string[], runner: ReleaseRunner = defaultRunner): void {
  const options = releaseOptions(args);
  const publish = publishArguments(options);
  const snapshot = snapshotArtifact(releaseArtifactPath(options.packageArtifact));
  try {
    const before = evaluationFingerprint(snapshot.path).packageArtifactSha256;
    const env = { ...process.env, HARNESS_RELEASE_ARTIFACT: snapshot.path };
    const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
    checkedRun('Release checks', pnpm, ['run', 'release:check'], env, runner);
    const after = evaluationFingerprint(snapshot.path).packageArtifactSha256;
    if (before !== after)
      throw new Error('Candidate package artifact changed during release checks');
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    checkedRun('npm publish', npm, ['publish', snapshot.path, ...publish], env, runner);
  } finally {
    snapshot.cleanup();
  }
}

const entry = process.argv[1] ? resolve(process.argv[1]) : '';
if (entry === fileURLToPath(import.meta.url)) {
  try {
    releaseCandidate(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
