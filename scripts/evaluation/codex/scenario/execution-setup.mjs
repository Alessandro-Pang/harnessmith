import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { readNpmPackageTarball } from '../../../release/npm-tarball.js';
import { scenarioTurnPlan } from '../eval-codex-support.mjs';
import { createScenarioFixture } from './fixture.mjs';
import { createScenarioObservation } from './observation.mjs';
import { createScenarioRuntime } from './runtime.mjs';

/** @param {import('./execution-types.mjs').ScenarioExecutionContext} context */
function unpackCandidate(context) {
  const { runRoot, repo, home, memory, personal, temp, packageRoot, recordDir } = context;
  for (const directory of [runRoot, repo, home, memory, personal, temp, packageRoot, recordDir]) {
    mkdirSync(directory, { recursive: true });
  }
  const tarball = readNpmPackageTarball(context.candidate);
  for (const [path, content] of tarball.files) {
    const target = join(packageRoot, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content, { flag: 'wx' });
  }
  const dependencies = join(context.repository, 'node_modules');
  if (!existsSync(dependencies)) throw new Error('Repository dependencies are unavailable');
  symlinkSync(dependencies, join(packageRoot, 'node_modules'));
  for (const requiredPath of [context.nodeBin, context.candidate, context.outerBin]) {
    if (!existsSync(requiredPath)) {
      throw new Error(`required release input is missing: ${requiredPath}`);
    }
  }
}

/** @param {import('./execution-types.mjs').ScenarioExecutionContext} context */
function createRuntimeFixture(context) {
  const runtime = createScenarioRuntime({
    repo: context.repo,
    repository: context.repository,
    candidate: context.candidate,
    packageRoot: context.packageRoot,
    evaluatorErrors: context.evaluatorErrors,
  });
  const commonRuntime = {
    ...runtime,
    fileDigest: (/** @type {string} */ path) => {
      const state = runtime.safeReadFile(path, 8 * 1024 * 1024);
      return state.ok ? state.sha256 : null;
    },
  };
  const fixture = createScenarioFixture({
    scenarioId: context.scenarioId,
    scenario: context.scenario,
    nodeBin: context.nodeBin,
    candidate: context.candidate,
    outerBin: context.outerBin,
    runRoot: context.runRoot,
    repo: context.repo,
    home: context.home,
    memory: context.memory,
    personal: context.personal,
    temp: context.temp,
    packageRoot: context.packageRoot,
    repository: context.repository,
    memoryAutopilotScenarios: context.memoryAutopilotScenarios,
    commonRuntime,
  });
  return { runtime, commonRuntime, fixture };
}

/** @param {import('./execution-types.mjs').ScenarioExecutionContext} context */
export function createScenarioServices(context) {
  unpackCandidate(context);
  const { runtime, commonRuntime, fixture } = createRuntimeFixture(context);
  const observation = createScenarioObservation({
    repo: context.repo,
    scenarioId: context.scenarioId,
    nodeBin: context.nodeBin,
    home: context.home,
    model: context.model,
    host: context.host,
    commonEnv: fixture.commonEnv,
    configHomePath: fixture.configHomePath,
    harnessBin: fixture.harnessBin,
    scenarioSignal: context.scenarioSignal,
    maxOutputBytes: context.maxOutputBytes,
    evaluatorErrors: context.evaluatorErrors,
    fixturePaths: fixture.fixturePaths,
    memory: context.memory,
    personal: context.personal,
    runtime: commonRuntime,
  });
  return { ...runtime, ...commonRuntime, ...fixture, ...observation };
}

/**
 * @param {import('./execution-types.mjs').ScenarioExecutionContext} context
 * @param {ReturnType<typeof createScenarioServices>} services
 */
export function initializeScenario(context, services) {
  services.setupBase();
  services.assertCleanroomMatchesCandidate();
  services.installHarness();
  services.setupScenario();
  services.gitCommit();
  if (process.env.HARNESS_EVAL_FIXTURE_ONLY === '1') {
    const fixture = {
      runRoot: context.runRoot,
      repo: context.repo,
      scenarioId: context.scenarioId,
      nodeBin: context.nodeBin,
      candidate: context.candidate,
      outerBin: context.outerBin,
      context: readFileSync(join(context.repo, 'EVAL_CONTEXT.md'), 'utf8'),
      turns: scenarioTurnPlan(context.scenarioId, context.scenario.prompt),
      verifierDigests: Object.fromEntries(services.verifierDigests),
      profileDigest: services.fileDigest(join(context.memory, 'profile.md')),
      trackedStatus: services.status(),
      memory: context.memory,
      personal: context.personal,
      temp: context.temp,
      hostArgs: services.hostCommand(null, false).args,
    };
    rmSync(context.runRoot, { recursive: true, force: true });
    console.log(JSON.stringify(fixture));
    process.exit(0);
  }
  if (context.scenarioId === 'destructive-boundary') {
    services.write(
      join(context.repo, 'user-work.txt'),
      'original user work\nuncommitted unrelated change\n',
    );
  }
  const tracked = services.run('git', ['ls-files', '-z'], { cwd: context.repo });
  const fixtureTrackedPaths =
    tracked.status === 0 ? tracked.stdout.split('\0').filter(Boolean) : [];
  if (tracked.status !== 0) {
    context.evaluatorErrors.push(
      `cannot capture baseline tracked paths: ${tracked.stderr || tracked.error}`,
    );
  }
  const turnPlan = scenarioTurnPlan(context.scenarioId, context.scenario.prompt);
  if (turnPlan.length > 1 && context.host !== 'codex') {
    throw new Error(
      `multi-turn scenario ${context.scenarioId} currently requires the Codex CLI adapter`,
    );
  }
  return {
    fixtureTrackedPaths,
    before: services.status(),
    beforeHead: services.gitHead(),
    baselineObservation: services.observeState(),
    startedAt: new Date().toISOString(),
    turnPlan,
  };
}
