import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { readNpmPackageTarball } from '../../../release/npm-tarball.js';
import { applyMemoryFixtureSeeds } from '../../memory/memory-fixture-seed.ts';
import { createEvalEnvironment } from '../support/environment.ts';
import { createMemoryProcessRuntime, createMemoryStateReader, digest } from './memory-runtime.mjs';
import { readMemoryScenario } from './memory-types.mjs';

/**
 * @param {{ repository: string, scenarioId: string, variant: number, candidate: string, outputRoot: string, model: string }} input
 */
export function prepareMemoryScenario(input) {
  const { repository, scenarioId, variant, candidate, outputRoot, model } = input;
  const runId = `codex-memory-${scenarioId}-${variant}-${randomUUID().slice(0, 8)}`;
  const root = join(tmpdir(), `harnessmith-memory-eval-${randomUUID()}`);
  const repo = join(root, 'repo');
  const home = join(root, 'home');
  const memory = join(root, 'global-memory', 'memory');
  const personal = join(root, 'personal-data', 'personal');
  const temp = join(repo, '.harness-eval-tmp');
  const packageRoot = join(root, 'candidate');
  const recordDir = join(outputRoot, runId);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  chmodSync(root, 0o700);
  process.on('exit', () => {
    rmSync(root, { recursive: true, force: true });
  });
  for (const path of [repo, home, memory, personal, temp, packageRoot, recordDir]) {
    mkdirSync(path, { recursive: true });
  }
  const { run, checked } = createMemoryProcessRuntime({ repo });
  const { snapshot, semanticState } = createMemoryStateReader({ repo, memory });
  const tarball = readNpmPackageTarball(candidate);
  for (const [path, content] of tarball.files) {
    const target = join(packageRoot, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content, { flag: 'wx' });
  }
  const scenario = readMemoryScenario(
    JSON.parse(readFileSync(join(packageRoot, 'evals/memory/scenarios.v1.json'), 'utf8')),
    scenarioId,
  );
  if (variant >= scenario.promptVariants.length) {
    throw new Error(`unknown memory scenario or prompt variant: ${scenarioId}/${variant}`);
  }
  /** @type {'global' | 'project'} */
  const scope =
    scenario.scope === 'global-profile' || scenario.scope === 'cross-session'
      ? 'global'
      : 'project';
  const packageJson = JSON.parse(tarball.files.get('package.json')?.toString('utf8') ?? '{}');
  const packageArtifactSha256 =
    process.env.HARNESS_EXPECTED_PACKAGE_SHA256 ?? digest(readFileSync(candidate));
  return {
    repository,
    scenarioId,
    variant,
    candidate,
    model,
    runId,
    root,
    repo,
    home,
    memory,
    personal,
    temp,
    packageRoot,
    recordDir,
    run,
    checked,
    snapshot,
    semanticState,
    scenario,
    scope,
    packageVersion: String(packageJson.version ?? 'unknown'),
    packageArtifactSha256,
  };
}

/** @param {ReturnType<typeof prepareMemoryScenario>} setup */
export function initializeMemoryFixture(setup) {
  const { repository, packageRoot, root, repo, home, memory, personal, temp, checked } = setup;
  const dependencies = join(repository, 'node_modules');
  if (!existsSync(dependencies)) throw new Error('Repository dependencies are unavailable');
  symlinkSync(dependencies, join(packageRoot, 'node_modules'));
  const nodeBin = process.execPath;
  const outerBin = join(packageRoot, 'bin/harnessmith.mjs');
  const sourceCodexHome = process.env.CODEX_HOME ?? join(process.env.HOME ?? '', '.codex');
  const authPath = sourceCodexHome ? join(sourceCodexHome, 'auth.json') : '';
  if (!authPath || !existsSync(authPath)) {
    throw new Error('Current Codex authentication is unavailable');
  }
  const configHome = join(root, 'codex-config');
  mkdirSync(configHome, { recursive: true });
  symlinkSync(authPath, join(configHome, 'auth.json'));
  writeFileSync(
    join(repo, 'package.json'),
    '{"name":"memory-eval","private":true,"type":"module"}\n',
  );
  writeFileSync(join(repo, 'README.md'), '# Disposable Memory Evaluation\n');
  const env = createEvalEnvironment({
    HARNESS_MEMORY_HOME: memory,
    HARNESS_PERSONAL_HOME: personal,
    HARNESS_REPOSITORY_ROOT: repo,
    TMPDIR: temp,
    HOME: home,
    CODEX_HOME: configHome,
    PATH: `${process.env.PATH ?? ''}:${dirname(nodeBin)}`,
  });
  checked('git', ['init', '-b', 'main'], { cwd: repo, env });
  checked(
    nodeBin,
    [outerBin, 'install', '--agent', 'codex', '--project', repo, '--yes', '--json'],
    { env },
  );
  const harnessBin = outerBin;
  checked(nodeBin, [harnessBin, 'init', 'global'], { env });
  checked(nodeBin, [harnessBin, 'init', 'project', repo], { cwd: repo, env });
  applyMemoryFixtureSeeds({
    globalMemory: setup.scenario.setup.globalMemory,
    projectMemory: setup.scenario.setup.projectMemory,
    context: { repo, tempDir: temp },
    run: (argv) => checked(nodeBin, [harnessBin, ...argv], { cwd: repo, env }),
  });
  return { nodeBin, harnessBin, env };
}
