import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { digest, safeReadFile } from './runtime-files.mjs';

/** @param {{ repo: string, repository: string, candidate: string, packageRoot: string }} context */
export function createProcessRuntime({ repo, repository, candidate, packageRoot }) {
  /**
   * @param {string} command
   * @param {string[]} args
   * @param {import('../support/types.mjs').RunOptions} [options]
   */
  function run(command, args, options = {}) {
    const result = spawnSync(command, args, {
      cwd: options.cwd ?? repo,
      encoding: 'utf8',
      env: { ...process.env, ...options.env },
      maxBuffer: 24 * 1024 * 1024,
      timeout: options.timeout ?? 240_000,
      killSignal: 'SIGKILL',
    });
    return {
      status: result.status,
      signal: result.signal,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      error: result.error?.message,
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

  /** @param {string} path */
  function fileDigest(path) {
    const state = safeReadFile(path, 8 * 1024 * 1024);
    return state.ok ? state.sha256 : null;
  }

  function assertCleanroomMatchesCandidate() {
    const entries = checked('tar', ['-tzf', candidate], { cwd: repository })
      .stdout.split(/\r?\n/)
      .filter(Boolean);
    for (const entry of entries) {
      if (!entry.startsWith('package/') || entry.endsWith('/')) {
        throw new Error(`unexpected candidate tar entry: ${entry}`);
      }
      const packagePath = entry.slice('package/'.length);
      if (!packagePath || packagePath.split('/').includes('..')) {
        throw new Error(`unsafe candidate tar entry: ${entry}`);
      }
      const installedPath = join(packageRoot, packagePath);
      if (!existsSync(installedPath)) {
        throw new Error(`clean-room package is missing candidate entry: ${packagePath}`);
      }
      const extracted = spawnSync('tar', ['-xOf', candidate, entry], {
        cwd: repository,
        encoding: null,
        maxBuffer: 24 * 1024 * 1024,
      });
      if (extracted.status !== 0 || !Buffer.isBuffer(extracted.stdout)) {
        throw new Error(`cannot read candidate tar entry: ${entry}`);
      }
      if (digest(extracted.stdout) !== fileDigest(installedPath)) {
        throw new Error(`clean-room package differs from candidate entry: ${packagePath}`);
      }
    }
  }

  /** @param {string} path @param {string | Buffer} content */
  function write(path, content) {
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, content);
  }

  return { run, checked, assertCleanroomMatchesCandidate, write };
}
