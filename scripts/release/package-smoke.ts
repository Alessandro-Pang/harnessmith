import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readNpmPackageTarball } from './npm-tarball.js';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

type PackageManifest = {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  exports?: Record<string, string | { types?: string; import?: string }>;
  bin?: Record<string, string>;
};

function artifactArgument(args: string[]): string {
  const index = args.indexOf('--artifact');
  const value = index >= 0 ? args[index + 1] : undefined;
  if (!value) throw new Error('Usage: package-smoke --artifact <npm-tarball> [--online]');
  return value;
}

function writePackage(files: ReadonlyMap<string, Buffer>, root: string): PackageManifest {
  const packageRoot = join(root, 'node_modules', 'harnessmith');
  for (const [path, content] of files) {
    const target = join(packageRoot, path);
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    writeFileSync(target, content, { mode: 0o600 });
  }
  return JSON.parse(files.get('package.json')?.toString('utf8') ?? '{}') as PackageManifest;
}

function linkRuntimeDependencies(root: string, manifest: PackageManifest): void {
  const targetRoot = join(root, 'node_modules');
  for (const name of Object.keys(manifest.dependencies ?? {})) {
    const target = join(targetRoot, name);
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    symlinkSync(resolve(repositoryRoot, 'node_modules', name), target, 'junction');
  }
}

function verifyTypeScriptConsumer(root: string): void {
  const typesTarget = join(root, 'node_modules', '@types', 'node');
  mkdirSync(dirname(typesTarget), { recursive: true, mode: 0o700 });
  symlinkSync(resolve(repositoryRoot, 'node_modules', '@types', 'node'), typesTarget, 'junction');
  writeFileSync(
    join(root, 'consumer.mts'),
    `import { run } from 'harnessmith';
const result: Promise<number> = run([]);
void result;
// @ts-expect-error internal deep imports are not part of the public package contract.
import 'harnessmith/dist/shared/types.js';
`,
    { mode: 0o600 },
  );
  writeFileSync(
    join(root, 'tsconfig.json'),
    `${JSON.stringify({
      compilerOptions: {
        target: 'ES2023',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        strict: true,
        noEmit: true,
        skipLibCheck: false,
        types: ['node'],
      },
      include: ['consumer.mts'],
    })}\n`,
    { mode: 0o600 },
  );
  const result = spawnSync(
    process.execPath,
    [resolve(repositoryRoot, 'node_modules', 'typescript', 'bin', 'tsc'), '--project', root],
    { cwd: root, encoding: 'utf8', env: { ...process.env, NODE_ENV: 'test' } },
  );
  if (result.status !== 0) {
    throw new Error(`Packed package TypeScript consumer failed: ${result.stderr || result.stdout}`);
  }
}

function exerciseGlobalLauncher(binDirectory: string, home: string): string {
  const executable = process.platform === 'win32' ? 'harnessmith.cmd' : 'harnessmith';
  const env = {
    ...process.env,
    PATH: `${binDirectory}${delimiter}${process.env.PATH ?? ''}`,
    HOME: home,
    CODEX_HOME: join(home, 'codex-home'),
    HARNESS_HOME: join(home, 'hub'),
    HARNESS_MEMORY_HOME: join(home, 'agent-docs'),
    HARNESS_PERSONAL_HOME: join(home, 'personal-harness'),
    HARNESS_REPOSITORY_ROOT: home,
    HARNESS_OWNER: 'package-smoke',
    NODE_ENV: 'test',
  };
  const installHarness = spawnSync(
    executable,
    ['install', '--agent', 'codex', '--no-init-global', '--yes', '--json'],
    { cwd: home, encoding: 'utf8', env },
  );
  if (installHarness.status !== 0) {
    throw new Error(
      `Global PATH shim could not install the Harness: ${installHarness.stderr || installHarness.stdout}`,
    );
  }
  const runtime = spawnSync(executable, ['version', '--json'], {
    cwd: home,
    encoding: 'utf8',
    env,
  });
  if (runtime.status !== 0) {
    throw new Error(
      `Global PATH shim could not dispatch to the installed Runtime: ${runtime.stderr || runtime.stdout}`,
    );
  }
  const report = JSON.parse(runtime.stdout) as { harnessVersion?: string };
  if (!report.harnessVersion) throw new Error('Global Runtime version output is incomplete');
  return report.harnessVersion;
}

// Explicit opt-in: a real `npm install --global` of the tarball with a fresh cache.
// This resolves dependencies from the registry and therefore requires network access.
function verifyGlobalLauncherOnline(artifact: string, root: string): string {
  const prefix = join(root, 'global-prefix');
  const home = join(root, 'global-home');
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const installPackage = spawnSync(
    npm,
    [
      'install',
      '--global',
      resolve(artifact),
      '--prefix',
      prefix,
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--no-update-notifier',
      '--cache',
      join(root, 'npm-cache'),
    ],
    { cwd: root, encoding: 'utf8', env: { ...process.env, HOME: home, NODE_ENV: 'test' } },
  );
  if (installPackage.status !== 0) {
    throw new Error(
      `Packed package global installation failed: ${installPackage.stderr || installPackage.stdout}`,
    );
  }
  const binDirectory = process.platform === 'win32' ? prefix : join(prefix, 'bin');
  return exerciseGlobalLauncher(binDirectory, home);
}

// Default offline contract: stage the exact tarball bytes in npm's global layout and
// symlink the repository's installed production dependencies. No npm, no registry;
// the real bin launcher, PATH dispatch, and embedded Runtime are still exercised.
function verifyGlobalLauncherOffline(
  files: ReadonlyMap<string, Buffer>,
  manifest: PackageManifest,
  root: string,
): string {
  const prefix = join(root, 'global-prefix');
  const home = join(root, 'global-home');
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const libRoot = process.platform === 'win32' ? prefix : join(prefix, 'lib');
  const packageRoot = join(libRoot, 'node_modules', 'harnessmith');
  writePackage(files, libRoot);
  linkRuntimeDependencies(packageRoot, manifest);
  const launcher = join(packageRoot, 'bin', 'harnessmith.mjs');
  chmodSync(launcher, 0o755);
  const binDirectory = process.platform === 'win32' ? prefix : join(prefix, 'bin');
  mkdirSync(binDirectory, { recursive: true, mode: 0o700 });
  if (process.platform === 'win32') {
    writeFileSync(
      join(binDirectory, 'harnessmith.cmd'),
      '@echo off\r\nnode "%~dp0node_modules\\harnessmith\\bin\\harnessmith.mjs" %*\r\n',
      { mode: 0o700 },
    );
  } else {
    symlinkSync(
      join('..', 'lib', 'node_modules', 'harnessmith', 'bin', 'harnessmith.mjs'),
      join(binDirectory, 'harnessmith'),
    );
  }
  return exerciseGlobalLauncher(binDirectory, home);
}

export function verifyPackageSmoke(
  artifact: string,
  options: { online?: boolean } = {},
): {
  version: string;
  exported: string[];
  globalBin: string;
  runtimeVersion: string;
} {
  const tarball = readNpmPackageTarball(artifact);
  const root = mkdtempSync(join('/tmp', 'harnessmith-package-smoke-'));
  try {
    const manifest = writePackage(tarball.files, root);
    if (manifest.name !== 'harnessmith' || !manifest.version)
      throw new Error('Packed manifest has an invalid package identity');
    const entry = manifest.exports?.['.'];
    if (
      typeof entry !== 'object' ||
      entry.types !== './dist/cli.d.ts' ||
      entry.import !== './dist/cli.js'
    ) {
      throw new Error('Packed manifest does not expose the typed CLI entry');
    }
    if (manifest.bin?.harnessmith !== 'bin/harnessmith.mjs')
      throw new Error('Packed manifest does not expose the CLI launcher');
    for (const path of ['dist/cli.d.ts', 'dist/cli.js.map', 'dist/harness.mjs.map']) {
      if (!tarball.files.has(path)) throw new Error(`Packed package is missing: ${path}`);
    }
    linkRuntimeDependencies(root, manifest);
    verifyTypeScriptConsumer(root);
    const script = `
      const pkg = await import('harnessmith');
      if (typeof pkg.run !== 'function') throw new Error('root import does not expose run');
      try {
        await import('harnessmith/dist/shared/types.js');
        throw new Error('internal deep import unexpectedly succeeded');
      } catch (error) {
        if (error?.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw error;
      }
      const version = await import('node:fs').then(({ readFileSync }) =>
        readFileSync(new URL(import.meta.resolve('harnessmith/package.json')), 'utf8'));
      if (JSON.parse(version).version !== ${JSON.stringify(manifest.version)})
        throw new Error('root import resolved the wrong package version');
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, NODE_ENV: 'test' },
    });
    if (result.status !== 0) {
      throw new Error(`Packed package import smoke failed: ${result.stderr || result.stdout}`);
    }
    const runtimeVersion = options.online
      ? verifyGlobalLauncherOnline(artifact, root)
      : verifyGlobalLauncherOffline(tarball.files, manifest, root);
    return {
      version: manifest.version,
      exported: ['run'],
      globalBin: 'harnessmith',
      runtimeVersion,
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const args = process.argv.slice(2);
  const result = verifyPackageSmoke(artifactArgument(args), { online: args.includes('--online') });
  console.log(
    `Package smoke passed for harnessmith@${result.version}: ${result.exported.join(', ')}`,
  );
}
