import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readNpmPackageTarball } from '../../release/npm-tarball.js';
import type { CodexMatrixOptions } from './eval-codex-options.js';
import type { ReasoningScenario } from './eval-codex-reasoning-types.js';

export type ReasoningFixture = {
  repo: string;
  memory: string;
  env: NodeJS.ProcessEnv;
};

function runSetup(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): void {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed: ${result.stderr || result.error?.message}`,
    );
  }
}

export function prepareReasoningFixture(
  options: CodexMatrixOptions,
  scenario: ReasoningScenario,
): ReasoningFixture {
  const root = join(tmpdir(), `harnessmith-codex-reasoning-${randomUUID()}`);
  const repo = join(root, 'repo');
  const home = join(root, 'home');
  const memory = join(root, 'memory');
  const personal = join(root, 'personal');
  const temp = join(repo, '.harness-eval-tmp');
  const packageRoot = join(root, 'candidate');
  for (const path of [repo, home, memory, personal, temp, packageRoot])
    mkdirSync(path, { recursive: true });
  const tarball = readNpmPackageTarball(options.packageArtifact);
  for (const [path, content] of tarball.files) {
    const target = join(packageRoot, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content, { flag: 'wx' });
  }
  const repository = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
  const dependencies = join(repository, 'node_modules');
  if (!existsSync(dependencies)) throw new Error('Repository dependencies are unavailable');
  symlinkSync(dependencies, join(packageRoot, 'node_modules'));
  const nodeBin = process.execPath;
  const outerBin = join(packageRoot, 'bin/harnessmith.mjs');
  const sourceCodexHome = process.env.CODEX_HOME ?? join(process.env.HOME ?? '', '.codex');
  const authPath = join(sourceCodexHome, 'auth.json');
  if (!existsSync(authPath)) throw new Error('Current Codex authentication is unavailable');
  const configHome = join(root, 'codex-config');
  mkdirSync(configHome, { recursive: true });
  symlinkSync(authPath, join(configHome, 'auth.json'));
  const env = {
    ...process.env,
    HOME: home,
    CODEX_HOME: configHome,
    HARNESS_MEMORY_HOME: memory,
    HARNESS_PERSONAL_HOME: personal,
    HARNESS_REPOSITORY_ROOT: repo,
    TMPDIR: temp,
  };
  mkdirSync(join(repo, '.harness-eval', 'fixtures'), { recursive: true });
  writeFileSync(
    join(repo, '.harness-eval', 'fixtures', 'reasoning.json'),
    `${JSON.stringify(scenario.fixture.facts, null, 2)}\n`,
  );
  writeFileSync(join(repo, '.harness-eval', 'fixtures', 'simple.txt'), 'pending\n');
  writeFileSync(join(repo, 'README.md'), '# reasoning evaluation\n');
  runSetup('git', ['init', '-b', 'main'], repo, env);
  runSetup(
    nodeBin,
    [outerBin, 'install', '--agent', 'codex', '--project', repo, '--yes', '--json'],
    repo,
    env,
  );
  return { repo, memory, env };
}
