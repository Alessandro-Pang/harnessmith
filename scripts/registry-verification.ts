import { existsSync, lstatSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import writeFileAtomic from 'write-file-atomic';
import { createTemporaryWorkspace, disposeTemporaryWorkspace } from '../src/temporary-resource.js';
import { readNpmPackageTarball } from './npm-tarball.js';
import {
  defaultRegistryRunner,
  downloadRegistryArtifact,
  fetchRegistryMetadata,
  installRegistryArtifact,
  registryEnvironment,
} from './registry-verification-registry.js';
import { type RegistrySmokePaths, runRegistrySmoke } from './registry-verification-smoke.js';
import {
  officialRegistry,
  RegistryVerificationError,
  RegistryVerificationFailure,
  type RegistryVerificationFailureReport,
  type RegistryVerificationOptions,
  type RegistryVerificationReport,
  type RegistryVerificationRunner,
} from './registry-verification-types.js';

export type {
  RegistryVerificationOptions,
  RegistryVerificationReport,
  RegistryVerificationRunner,
} from './registry-verification-types.js';

function evidenceTarget(path: string): string {
  const target = resolve(path);
  const parent = dirname(target);
  if (!existsSync(parent) || !lstatSync(parent).isDirectory()) {
    throw new Error(`Evidence directory does not exist: ${parent}`);
  }
  if (existsSync(target)) {
    const entry = lstatSync(target);
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new Error(`Evidence target must be a regular file: ${target}`);
    }
  }
  return target;
}

function writeReport(
  path: string,
  report: RegistryVerificationReport | RegistryVerificationFailureReport,
): void {
  writeFileAtomic.sync(path, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
}

function validateOptions(options: RegistryVerificationOptions): void {
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(options.packageName)) {
    throw new Error(`Unsupported npm package name: ${options.packageName}`);
  }
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(options.version)) {
    throw new Error(`Expected an exact npm package version, received: ${options.version}`);
  }
}

function workspacePaths(workspace: string): RegistrySmokePaths & { downloads: string } {
  const home = join(workspace, 'home');
  const paths = {
    workspace,
    downloads: join(workspace, 'downloads'),
    installRoot: join(workspace, 'install'),
    home,
    codexHome: join(home, '.codex'),
  };
  for (const directory of [
    paths.downloads,
    paths.installRoot,
    paths.home,
    paths.codexHome,
    join(home, '.agent-docs'),
    join(home, '.agent-harness'),
  ]) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  return paths;
}

function workspaceEnvironment(paths: RegistrySmokePaths): NodeJS.ProcessEnv {
  return {
    ...registryEnvironment(paths.workspace),
    CODEX_HOME: paths.codexHome,
    HARNESS_MEMORY_HOME: join(paths.home, '.agent-docs'),
    HARNESS_PERSONAL_HOME: join(paths.home, '.agent-harness'),
    HARNESS_REPOSITORY_ROOT: join(paths.home, 'git-repo'),
    HARNESS_OWNER: 'registry-verification',
  };
}

function hasProvenance(metadata: Awaited<ReturnType<typeof fetchRegistryMetadata>>['metadata']) {
  return (
    metadata.dist?.attestations?.provenance?.predicateType === 'https://slsa.dev/provenance/v1' &&
    typeof metadata.dist.attestations.url === 'string'
  );
}

async function executeVerification(
  options: RegistryVerificationOptions,
  workspace: string,
  runner: RegistryVerificationRunner,
  sleep: (milliseconds: number) => Promise<void>,
): Promise<{ report: RegistryVerificationReport; attempts: number }> {
  const expectedSha256 = readNpmPackageTarball(options.expectedArtifact).sha256;
  const paths = workspacePaths(workspace);
  const env = workspaceEnvironment(paths);
  const { attempts, metadata } = await fetchRegistryMetadata(
    options,
    workspace,
    env,
    runner,
    sleep,
  );
  try {
    const provenance = hasProvenance(metadata);
    if (options.requireProvenance && !provenance) {
      throw new RegistryVerificationError(
        'REGISTRY_METADATA_MISMATCH',
        `Registry provenance metadata is missing for ${options.packageName}@${options.version}`,
        attempts,
      );
    }
    const downloaded = downloadRegistryArtifact(
      options,
      metadata,
      attempts,
      expectedSha256,
      workspace,
      paths.downloads,
      env,
      runner,
    );
    installRegistryArtifact(downloaded.path, paths.installRoot, workspace, env, runner);
    const smoke = runRegistrySmoke(options, paths, env, runner);
    return {
      attempts,
      report: {
        version: 1,
        valid: true,
        package: { name: options.packageName, version: options.version },
        registry: {
          url: officialRegistry,
          tarball: metadata.dist?.tarball as string,
          provenance,
          attempts,
        },
        artifact: downloaded.artifact,
        smoke,
        verifiedAt: new Date().toISOString(),
      },
    };
  } catch (error) {
    if (error instanceof RegistryVerificationError && error.attempts === 0) {
      throw new RegistryVerificationError(error.code, error.message, attempts);
    }
    throw error;
  }
}

export async function verifyRegistryPackage(
  options: RegistryVerificationOptions,
  runner: RegistryVerificationRunner = defaultRegistryRunner,
  sleep: (milliseconds: number) => Promise<void> = (milliseconds) =>
    new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds)),
): Promise<RegistryVerificationReport> {
  validateOptions(options);
  const target = evidenceTarget(options.evidenceFile);
  const workspace = createTemporaryWorkspace({
    owner: 'release',
    purpose: 'registry-verification',
    lifecycle: 'retained-for-recovery',
    retainOnFailure: true,
  });
  let attempts = 0;
  try {
    const result = await executeVerification(options, workspace.path, runner, sleep);
    attempts = result.attempts;
    writeReport(target, result.report);
    disposeTemporaryWorkspace(workspace);
    return result.report;
  } catch (error) {
    const classified =
      error instanceof RegistryVerificationError
        ? error
        : new RegistryVerificationError(
            'REGISTRY_RUNTIME_FAILURE',
            error instanceof Error ? error.message : String(error),
          );
    const report: RegistryVerificationFailureReport = {
      version: 1,
      valid: false,
      package: { name: options.packageName, version: options.version },
      registry: { url: officialRegistry, attempts: classified.attempts || attempts },
      error: { code: classified.code, message: classified.message },
      recoveryPath: workspace.path,
      verifiedAt: new Date().toISOString(),
    };
    writeReport(target, report);
    throw new RegistryVerificationFailure(report, error);
  }
}
