import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { execaSync } from 'execa';
import { readNpmPackageTarball } from './npm-tarball.js';
import {
  officialRegistry,
  type RegistryMetadata,
  RegistryVerificationError,
  type RegistryVerificationOptions,
  type RegistryVerificationRunner,
  type RunOptions,
} from './registry-verification-types.js';

export const defaultRegistryRunner: RegistryVerificationRunner = (executable, args, options) => {
  const result = execaSync(executable, args, {
    cwd: options.cwd,
    env: options.env,
    reject: false,
  });
  return {
    status: result.exitCode ?? null,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
};

export function checkedRegistryRun(
  label: string,
  executable: string,
  args: string[],
  options: RunOptions,
  runner: RegistryVerificationRunner,
): string {
  const result = runner(executable, args, options);
  if (result.status !== 0) {
    throw new RegistryVerificationError(
      'REGISTRY_RUNTIME_FAILURE',
      `${label} failed with exit ${String(result.status)}`,
    );
  }
  return result.stdout;
}

export function registryEnvironment(workspace: string): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(?:NODE_AUTH_TOKEN|NPM_TOKEN)$/i.test(key) || /^npm_config_.*auth/i.test(key))
      delete env[key];
  }
  return {
    ...env,
    HOME: join(workspace, 'home'),
    npm_config_cache: join(workspace, 'npm-cache'),
    npm_config_registry: officialRegistry,
    npm_config_userconfig: join(workspace, 'empty-npmrc'),
  };
}

function metadataError(message: string): never {
  throw new RegistryVerificationError('REGISTRY_METADATA_MISMATCH', message);
}

function parseMetadata(content: string, packageName: string, version: string): RegistryMetadata {
  let metadata: RegistryMetadata;
  try {
    metadata = JSON.parse(content) as RegistryMetadata;
  } catch {
    return metadataError(`Registry metadata for ${packageName}@${version} is not valid JSON`);
  }
  if (metadata.version !== version) {
    return metadataError(`Registry metadata version does not match ${packageName}@${version}`);
  }
  const expectedTarball = `${officialRegistry}${packageName}/-/${packageName}-${version}.tgz`;
  if (metadata.dist?.tarball !== expectedTarball) {
    return metadataError(`Registry tarball URL does not match ${packageName}@${version}`);
  }
  if (!/^[a-f0-9]{40}$/.test(metadata.dist.shasum ?? '')) {
    return metadataError(`Registry shasum is invalid for ${packageName}@${version}`);
  }
  if (!/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(metadata.dist.integrity ?? '')) {
    return metadataError(`Registry integrity is invalid for ${packageName}@${version}`);
  }
  return metadata;
}

export async function fetchRegistryMetadata(
  options: RegistryVerificationOptions,
  workspace: string,
  env: NodeJS.ProcessEnv,
  runner: RegistryVerificationRunner,
  sleep: (milliseconds: number) => Promise<void>,
): Promise<{ attempts: number; metadata: RegistryMetadata }> {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    const result = runner(
      npm,
      [
        'view',
        `${options.packageName}@${options.version}`,
        'version',
        'dist',
        '--json',
        `--registry=${officialRegistry}`,
      ],
      { cwd: workspace, env },
    );
    if (result.status === 0) {
      try {
        return {
          attempts: attempt,
          metadata: parseMetadata(result.stdout, options.packageName, options.version),
        };
      } catch (error) {
        if (error instanceof RegistryVerificationError && error.attempts === 0) {
          throw new RegistryVerificationError(error.code, error.message, attempt);
        }
        throw error;
      }
    }
    if (attempt < options.maxAttempts) await sleep(options.retryDelayMs);
  }
  throw new RegistryVerificationError(
    'REGISTRY_PROPAGATION_TIMEOUT',
    `${options.packageName}@${options.version} did not become visible in the official npm registry after ${options.maxAttempts} attempts`,
    options.maxAttempts,
  );
}

function packFilename(content: string): string {
  let records: Array<{ filename?: string }>;
  try {
    records = JSON.parse(content) as Array<{ filename?: string }>;
  } catch {
    throw new RegistryVerificationError(
      'REGISTRY_RUNTIME_FAILURE',
      'npm pack did not return valid JSON',
    );
  }
  const filename = records.length === 1 ? records[0]?.filename : undefined;
  if (!filename || filename !== basename(filename) || !filename.endsWith('.tgz')) {
    throw new RegistryVerificationError(
      'REGISTRY_RUNTIME_FAILURE',
      'npm pack did not return one safe tarball filename',
    );
  }
  return filename;
}

export function downloadRegistryArtifact(
  options: RegistryVerificationOptions,
  metadata: RegistryMetadata,
  attempts: number,
  expectedSha256: string,
  workspace: string,
  downloads: string,
  env: NodeJS.ProcessEnv,
  runner: RegistryVerificationRunner,
): { path: string; artifact: { sha1: string; sha256: string; integrity: string } } {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const packed = checkedRegistryRun(
    'Registry package download',
    npm,
    [
      'pack',
      `${options.packageName}@${options.version}`,
      '--json',
      '--ignore-scripts',
      '--pack-destination',
      downloads,
      `--registry=${officialRegistry}`,
    ],
    { cwd: workspace, env },
    runner,
  );
  const path = join(downloads, packFilename(packed));
  const content = readFileSync(path);
  const artifact = {
    sha1: createHash('sha1').update(content).digest('hex'),
    sha256: readNpmPackageTarball(path).sha256,
    integrity: `sha512-${createHash('sha512').update(content).digest('base64')}`,
  };
  if (
    artifact.sha1 !== metadata.dist?.shasum ||
    artifact.integrity !== metadata.dist?.integrity ||
    artifact.sha256 !== expectedSha256
  ) {
    throw new RegistryVerificationError(
      'REGISTRY_INTEGRITY_MISMATCH',
      `Registry package integrity does not match ${options.packageName}@${options.version}`,
      attempts,
    );
  }
  return { path, artifact };
}

export function installRegistryArtifact(
  artifact: string,
  installRoot: string,
  workspace: string,
  env: NodeJS.ProcessEnv,
  runner: RegistryVerificationRunner,
): void {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  checkedRegistryRun(
    'Registry package installation',
    npm,
    [
      'install',
      artifact,
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--package-lock=false',
      '--prefix',
      installRoot,
      '--cache',
      join(workspace, 'npm-cache'),
      `--registry=${officialRegistry}`,
    ],
    { cwd: workspace, env },
    runner,
  );
}
