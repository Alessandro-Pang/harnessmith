import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { sanitizeAndBoundArtifact } from '../support/artifacts.mjs';
import { createSessionSnapshots } from './observation-transcript.mjs';

/**
 * @typedef {{ repo: string, nodeBin: string, home: string, commonEnv: Record<string, string>, harnessBin: () => string, evaluatorErrors: string[], fixturePaths: import('../support/types.mjs').FixturePaths, memory: string, personal: string, runtime: ReturnType<typeof import('./runtime.mjs').createScenarioRuntime> }} StateObservationConfig
 */

/** @param {StateObservationConfig} config */
function status(config) {
  const state = config.runtime.run('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
    cwd: config.repo,
  });
  if (state.status !== 0) {
    config.evaluatorErrors.push(
      `git status failed: ${state.stderr || state.error || String(state.status)}`,
    );
  }
  return state.stdout;
}

/** @param {StateObservationConfig} config */
function gitHead(config) {
  const state = config.runtime.run('git', ['rev-parse', 'HEAD'], { cwd: config.repo });
  if (state.status !== 0) {
    config.evaluatorErrors.push(
      `git rev-parse HEAD failed: ${state.stderr || state.error || String(state.status)}`,
    );
    return null;
  }
  return state.stdout.trim();
}

/** @param {StateObservationConfig} config @param {string} path */
function fileDigest(config, path) {
  const state = config.runtime.safeReadFile(path, 8 * 1024 * 1024);
  return state.ok ? state.sha256 : null;
}

/** @param {StateObservationConfig} config @param {string} directory */
function markdownTreeDigest(config, directory) {
  if (!existsSync(directory)) return null;
  const hash = createHash('sha256');
  for (const path of config.runtime.markdownFiles(directory).sort()) {
    const state = config.runtime.safeReadFile(path, 256 * 1024);
    if (!state.ok) {
      config.evaluatorErrors.push(`cannot hash Markdown file ${path}: ${state.error}`);
      return null;
    }
    hash.update(`${relative(directory, path)}\0`);
    hash.update(state.content);
    hash.update('\0');
  }
  return hash.digest('hex');
}

/** @param {StateObservationConfig} config @param {string} scope */
function observeMemoryCheck(config, scope) {
  const result = config.runtime.run(
    config.nodeBin,
    [config.harnessBin(), 'memory', 'check', scope, '--json'],
    { cwd: config.repo, env: { ...config.commonEnv, HOME: config.home } },
  );
  const output = config.runtime.exactJsonObject(result.stdout);
  return {
    status: result.status,
    signal: result.signal,
    error: result.error,
    valid: Boolean(
      result.status === 0 &&
        output?.version === 1 &&
        output?.valid === true &&
        output?.indexed === false,
    ),
    diagnostics: sanitizeAndBoundArtifact(result.stderr, 2048).content,
  };
}

/** @param {StateObservationConfig} config @param {ReturnType<typeof createSessionSnapshots>} sessionSnapshots */
function observeState(config, sessionSnapshots) {
  const { repo, memory, personal, fixturePaths, runtime } = config;
  const profilePath = join(memory, 'profile.md');
  const projectCorePath = join(repo, '.agent-docs', 'core.md');
  const profileState = runtime.safeReadFile(profilePath, 256 * 1024);
  const projectCoreState = runtime.safeReadFile(projectCorePath, 256 * 1024);
  return {
    at: new Date().toISOString(),
    projectMemoryDigest: markdownTreeDigest(config, join(repo, '.agent-docs')),
    profileDigest: fileDigest(config, profilePath),
    profile: profileState.ok ? profileState.text : null,
    globalMemoryCheck: observeMemoryCheck(config, 'global'),
    projectCore: projectCoreState.ok ? projectCoreState.text : null,
    handoffs: {
      'host-thread-42': sessionSnapshots('host-thread-42'),
      'phase-thread-17': sessionSnapshots('phase-thread-17'),
      'multi-thread-23': sessionSnapshots('multi-thread-23'),
    },
    trackedStatus: status(config),
    trees: {
      project: runtime.treeSnapshot(repo, { excludeGit: true }),
      globalMemory: runtime.treeSnapshot(memory),
      personal: runtime.treeSnapshot(personal),
      target: fixturePaths.target
        ? runtime.treeSnapshot(fixturePaths.target, { excludeGit: true })
        : null,
      outside: fixturePaths.outside ? runtime.treeSnapshot(fixturePaths.outside) : null,
      evaluator: fixturePaths.captureWrapper
        ? runtime.treeSnapshot(dirname(fixturePaths.captureWrapper))
        : null,
    },
    captureWrapperSha256: fixturePaths.captureWrapper
      ? fileDigest(config, fixturePaths.captureWrapper)
      : null,
  };
}

/** @param {StateObservationConfig} config */
export function createStateObservation(config) {
  const sessionSnapshots = createSessionSnapshots({
    repo: config.repo,
    markdownFiles: config.runtime.markdownFiles,
    safeReadFile: config.runtime.safeReadFile,
    digest: config.runtime.digest,
    evaluatorErrors: config.evaluatorErrors,
  });
  return {
    status: () => status(config),
    gitHead: () => gitHead(config),
    fileDigest: (/** @type {string} */ path) => fileDigest(config, path),
    markdownTreeDigest: (/** @type {string} */ directory) => markdownTreeDigest(config, directory),
    sessionSnapshots,
    observeMemoryCheck: (/** @type {string} */ scope) => observeMemoryCheck(config, scope),
    observeState: () => observeState(config, sessionSnapshots),
  };
}
