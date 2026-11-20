import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { createEvalEnvironment } from '../support/environment.ts';
import { snapshotRegularFileTree } from '../support/safe-snapshot.mjs';

/** @param {string | Buffer} value */
export function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

/** @param {{ repo: string }} config */
export function createMemoryProcessRuntime({ repo }) {
  /**
   * @param {string} command
   * @param {string[]} args
   * @param {import('../support/types.mjs').RunOptions} [options]
   */
  function run(command, args, options = {}) {
    const result = spawnSync(command, args, {
      cwd: options.cwd ?? repo,
      encoding: 'utf8',
      env: createEvalEnvironment(options.env),
      maxBuffer: 8 * 1024 * 1024,
      timeout: 900_000,
    });
    return {
      status: result.status,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      error: result.error?.message ?? null,
    };
  }

  /**
   * @param {string} command
   * @param {string[]} args
   * @param {import('../support/types.mjs').RunOptions} [options]
   */
  function checked(command, args, options = {}) {
    const result = run(command, args, options);
    if (result.status !== 0) {
      throw new Error(`${command} ${args.join(' ')} failed: ${result.stderr || result.error}`);
    }
    return result;
  }
  return { run, checked };
}

/** @param {{ repo: string, memory: string }} config */
export function createMemoryStateReader({ repo, memory }) {
  /**
   * @param {string} directory
   * @param {string} prefix
   * @param {boolean} [includeContent]
   */
  function snapshotTree(directory, prefix, includeContent = false) {
    return snapshotRegularFileTree(directory, {
      prefix,
      includeContent,
      ignore: (path) => path.endsWith('.lock'),
    });
  }

  /** @param {'global' | 'project'} stateScope */
  function snapshot(stateScope) {
    const directory = stateScope === 'global' ? memory : join(repo, '.agent-docs');
    const prefix = stateScope === 'global' ? 'global' : 'project';
    const tree = snapshotTree(directory, prefix, true);
    /** @type {Record<string, string>} */
    const result = Object.fromEntries(
      Object.entries(tree).map(([path, entry]) => [path, entry.sha256]),
    );
    for (const path of [
      'global/README.md',
      'global/core.md',
      'project/.gitignore',
      'project/.ignore',
      'project/README.md',
    ]) {
      delete result[path];
    }
    const profile = tree['global/profile.md']?.content;
    if (result['global/profile.md'] && (!profile || !/^-\s+[^|]+\|/mu.test(profile))) {
      delete result['global/profile.md'];
    }
    const core = tree['project/core.md']?.content;
    if (result['project/core.md'] && (!core || !/memory:/mu.test(core))) {
      delete result['project/core.md'];
    }
    return { files: result };
  }

  /**
   * @param {string} directory
   * @param {string} prefix
   */
  function semanticFiles(directory, prefix) {
    return Object.fromEntries(
      Object.entries(snapshotTree(directory, prefix, true)).flatMap(([path, entry]) =>
        typeof entry.content === 'string' ? [[path, entry.content]] : [],
      ),
    );
  }

  /** @returns {import('../../memory/memory-contract-verifier.ts').MemoryContractState} */
  function semanticState() {
    return {
      global: semanticFiles(memory, ''),
      project: semanticFiles(join(repo, '.agent-docs'), ''),
    };
  }

  return { snapshot, semanticState };
}

/** @param {import('../../memory/memory-state-verifier.ts').MemoryFileState} state */
export function stateDigest(state) {
  return digest(JSON.stringify(Object.entries(state.files).sort()));
}
