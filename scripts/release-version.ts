import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { execaSync } from 'execa';
import writeFileAtomic from 'write-file-atomic';
import { repositoryRoot } from './eval-fingerprint.js';
import {
  finalizeReleaseVersion,
  verifyCiRelease,
  verifyReleaseAttestation,
} from './release-finalize.js';

interface CommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

interface RunOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
}

export type ReleaseCommandRunner = (
  executable: string,
  args: string[],
  options: RunOptions,
) => CommandResult;

const defaultRunner: ReleaseCommandRunner = (executable, args, options) => {
  const result = execaSync(executable, args, {
    cwd: options.cwd,
    env: options.env,
    reject: false,
  });
  return {
    status: result.exitCode ?? null,
    stdout: result.stdout,
    stderr: result.stderr,
  };
};

interface VersionOptions {
  now?: Date;
  root?: string;
}

const releaseFiles = ['package.json', 'pnpm-lock.yaml', 'CHANGELOG.md'] as const;

function checked(
  label: string,
  executable: string,
  args: string[],
  root: string,
  runner: ReleaseCommandRunner,
): string {
  const result = runner(executable, args, { cwd: root });
  if (result.status !== 0) {
    throw new Error(`${label} failed: ${result.stderr || `exit ${String(result.status)}`}`);
  }
  return result.stdout;
}

function packageManifest(root: string): { name: string; version: string } {
  return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    name: string;
    version: string;
  };
}

function assertReleaseCheckout(root: string, runner: ReleaseCommandRunner): void {
  const status = checked('Git status', 'git', ['status', '--porcelain'], root, runner);
  if (status.trim()) throw new Error('Release versioning requires a clean working tree');
  const branch = checked('Git branch', 'git', ['branch', '--show-current'], root, runner).trim();
  if (branch !== 'main')
    throw new Error(`Release versioning requires main, found ${branch || 'detached'}`);
}

function promoteChangelog(content: string, version: string, now: Date): string {
  const marker = '## Unreleased';
  if (!content.includes(marker)) throw new Error('CHANGELOG.md must contain an Unreleased section');
  return content.replace(marker, `${marker}\n\n## ${version} - ${now.toISOString().slice(0, 10)}`);
}

function restoreFiles(root: string, snapshots: Map<string, string | undefined>): void {
  for (const [name, content] of snapshots) {
    const path = join(root, name);
    if (content === undefined) rmSync(path, { force: true });
    else writeFileSync(path, content);
  }
}

export function prepareReleaseVersion(
  args: string[],
  runner: ReleaseCommandRunner = defaultRunner,
  options: VersionOptions = {},
): { candidate: string; tag: string; version: string } {
  const [increment, ...extra] = args;
  if (!['patch', 'minor', 'major'].includes(increment ?? '') || extra.length > 0) {
    throw new Error('Usage: npm run release -- patch|minor|major');
  }
  const root = resolve(options.root ?? repositoryRoot);
  assertReleaseCheckout(root, runner);
  const snapshots = new Map(
    releaseFiles.map((name) => {
      const path = join(root, name);
      return [name, existsSync(path) ? readFileSync(path, 'utf8') : undefined] as const;
    }),
  );
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  try {
    checked(
      'npm version',
      npm,
      ['version', increment as string, '--no-git-tag-version', '--ignore-scripts'],
      root,
      runner,
    );
    const manifest = packageManifest(root);
    const changelogPath = join(root, 'CHANGELOG.md');
    writeFileAtomic.sync(
      changelogPath,
      promoteChangelog(
        readFileSync(changelogPath, 'utf8'),
        manifest.version,
        options.now ?? new Date(),
      ),
    );
    checked('Release preflight', pnpm, ['run', 'preflight'], root, runner);
    const directory = join(root, '.release');
    mkdirSync(directory, { mode: 0o700, recursive: true });
    const packed = checked(
      'npm pack',
      npm,
      ['pack', '--json', '--ignore-scripts', '--pack-destination', directory],
      root,
      runner,
    );
    const records = JSON.parse(packed) as Array<{ filename?: string }>;
    const filename = records[0]?.filename;
    if (!filename || basename(filename) !== filename || !filename.endsWith('.tgz')) {
      throw new Error('npm pack did not return one safe candidate filename');
    }
    const candidate = join(directory, filename);
    if (!existsSync(candidate)) throw new Error(`npm pack candidate is missing: ${candidate}`);
    chmodSync(candidate, 0o400);
    return { candidate, tag: `v${manifest.version}`, version: manifest.version };
  } catch (error) {
    restoreFiles(root, snapshots);
    throw error;
  }
}

export { verifyReleaseAttestation };

function main(): void {
  const program = new Command().name('release');
  program
    .command('ci-verify')
    .requiredOption('--artifact <path>')
    .requiredOption('--tag <tag>')
    .action(({ artifact, tag }: { artifact: string; tag: string }) =>
      verifyCiRelease(artifact, tag),
    );
  program.command('finalize').action(() => {
    const result = finalizeReleaseVersion();
    console.log(`Created signed ${result.tag}. Push explicitly with:\n${result.pushCommand}`);
  });
  for (const increment of ['patch', 'minor', 'major']) {
    program.command(increment).action(() => {
      const result = prepareReleaseVersion([increment]);
      console.log(
        `Prepared ${result.version} candidate at ${result.candidate}. Run Host Eval, pnpm run release:prepare, then npm run release -- finalize.`,
      );
    });
  }
  program.parse();
}

const entry = process.argv[1] ? resolve(process.argv[1]) : '';
if (entry === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
