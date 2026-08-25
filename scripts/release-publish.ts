import { chmodSync, constants, copyFileSync, existsSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command, InvalidArgumentError } from 'commander';
import { execaSync } from 'execa';
import {
  evaluationFingerprint,
  releaseArtifactPath,
  requiredEvaluationAdapters,
} from './eval-fingerprint.js';
import { readNpmPackageTarball } from './npm-tarball.js';
import {
  checkedPreparedState,
  type ReleaseState,
  readReleaseState,
  releaseStateDirectory,
  writeReleaseState,
} from './release-state.js';

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

interface ReleaseCliOptions {
  access?: string;
  dryRun?: boolean;
  packageArtifact?: string;
  prepareOnly?: boolean;
  provenance?: boolean;
  stateDir?: string;
  tag?: string;
}

function releaseOptions(args: string[]): ReleaseCliOptions {
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

function prepareRelease(source: string, directory: string, runner: ReleaseRunner): ReleaseState {
  const fingerprint = evaluationFingerprint(source);
  const artifact = join(
    directory,
    `${fingerprint.packageArtifactSha256.slice(0, 16)}-${basename(source)}`,
  );
  let created = false;
  if (existsSync(artifact)) {
    if (readNpmPackageTarball(artifact).sha256 !== fingerprint.packageArtifactSha256) {
      throw new Error(`Prepared release artifact path contains different bytes: ${artifact}`);
    }
  } else {
    copyFileSync(source, artifact, constants.COPYFILE_EXCL);
    created = true;
  }
  chmodSync(artifact, 0o400);
  const env = { ...process.env, HARNESS_RELEASE_ARTIFACT: artifact };
  const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  try {
    checkedRun('Release checks', pnpm, ['run', 'release:check'], env, runner);
    const after = readNpmPackageTarball(artifact).sha256;
    if (fingerprint.packageArtifactSha256 !== after) {
      throw new Error('Candidate package artifact changed during release checks');
    }
  } catch (error) {
    if (created) rmSync(artifact, { force: true });
    throw error;
  }
  const previous = readReleaseState(directory);
  const state: ReleaseState = {
    schemaVersion: 2,
    status: 'prepared',
    artifactPath: artifact,
    artifactSha256: fingerprint.packageArtifactSha256,
    packageVersion: fingerprint.packageVersion,
    preparedAt: new Date().toISOString(),
    evaluation: {
      assurance: 'maintainer-attested-structure',
      coverageCount: requiredEvaluationAdapters.length * Object.keys(fingerprint.scenarios).length,
      packageArtifactSha256: fingerprint.packageArtifactSha256,
      harnessVersion: fingerprint.harnessVersion,
      rulesSha256: fingerprint.rulesSha256,
      scenarios: fingerprint.scenarios,
      requiredHosts: [...requiredEvaluationAdapters],
    },
  };
  writeReleaseState(directory, state);
  if (
    previous &&
    resolve(previous.artifactPath) !== artifact &&
    dirname(resolve(previous.artifactPath)) === directory
  ) {
    rmSync(resolve(previous.artifactPath), { force: true });
  }
  return state;
}

export function releasePublishGuard(env: NodeJS.ProcessEnv = process.env): void {
  if (env.HARNESS_RELEASE_WORKFLOW === '1') return;
  throw new Error(
    'Direct worktree npm publish is unsupported. Run pnpm run release:prepare once, then pnpm run release:publish; a failed publish can be resumed without rerunning release checks.',
  );
}

export function releaseCandidate(args: string[], runner: ReleaseRunner = defaultRunner): void {
  const options = releaseOptions(args);
  const directory = releaseStateDirectory(options.stateDir);
  const existing = readReleaseState(directory);
  const source = options.packageArtifact
    ? releaseArtifactPath(options.packageArtifact)
    : existing
      ? undefined
      : releaseArtifactPath();
  const state = source
    ? prepareRelease(source, directory, runner)
    : checkedPreparedState(directory, existing as ReleaseState);
  if (options.prepareOnly) return;

  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const env = {
    ...process.env,
    HARNESS_RELEASE_ARTIFACT: state.artifactPath,
    HARNESS_RELEASE_WORKFLOW: '1',
  };
  checkedRun(
    'npm publish',
    npm,
    ['publish', state.artifactPath, ...publishArguments(options)],
    env,
    runner,
  );
  if (!options.dryRun) {
    writeReleaseState(directory, {
      ...state,
      status: 'published',
      publishedAt: new Date().toISOString(),
    });
  }
}

const entry = process.argv[1] ? resolve(process.argv[1]) : '';
if (entry === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] === 'guard') releasePublishGuard();
    else releaseCandidate(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
