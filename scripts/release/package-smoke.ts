import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readNpmPackageTarball } from './npm-tarball.js';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

type PackageManifest = {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  exports?: Record<string, string>;
  bin?: Record<string, string>;
};

function artifactArgument(args: string[]): string {
  const index = args.indexOf('--artifact');
  const value = index >= 0 ? args[index + 1] : undefined;
  if (!value) throw new Error('Usage: package-smoke --artifact <npm-tarball>');
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

export function verifyPackageSmoke(artifact: string): { version: string; exported: string[] } {
  const tarball = readNpmPackageTarball(artifact);
  const root = mkdtempSync(join('/tmp', 'harnessmith-package-smoke-'));
  try {
    const manifest = writePackage(tarball.files, root);
    if (manifest.name !== 'harnessmith' || !manifest.version)
      throw new Error('Packed manifest has an invalid package identity');
    if (manifest.exports?.['.'] !== './dist/cli.js')
      throw new Error('Packed manifest does not expose the CLI entry');
    if (manifest.bin?.harnessmith !== 'bin/harnessmith.mjs')
      throw new Error('Packed manifest does not expose the CLI launcher');
    linkRuntimeDependencies(root, manifest);
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
    return { version: manifest.version, exported: ['run'] };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const result = verifyPackageSmoke(artifactArgument(process.argv.slice(2)));
  console.log(
    `Package smoke passed for harnessmith@${result.version}: ${result.exported.join(', ')}`,
  );
}
