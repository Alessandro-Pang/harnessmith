import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

/** @param {import('./fixture-types.mjs').FixtureConfig} config */
export function createFixtureCapture(config) {
  const { repo, repository, nodeBin, outerBin, commonRuntime } = config;
  const { write, digest, fileDigest } = commonRuntime;
  /** @type {Map<string, string | null>} */
  const verifierDigests = new Map();
  /** @type {import('../support/types.mjs').FixturePaths} */
  const fixturePaths = {};
  /** @param {string} name @param {string[]} paths */
  function setupVerifier(name, paths) {
    for (const path of paths) write(join(repo, path), 'pending');
    write(
      join(repo, name),
      `import { readFileSync } from 'node:fs';\nconst allowed = new Set(${JSON.stringify(paths)});\nconst [target, ...rest] = process.argv.slice(2);\nif (rest.length || !allowed.has(target)) process.exit(2);\nprocess.exit(readFileSync(target, 'utf8').replace(/\\r?\\n$/, '') === 'ready' ? 0 : 1);\n`,
    );
    verifierDigests.set(name, fileDigest(join(repo, name)));
  }
  /** @param {string} target */
  function setupInstallCapture(target) {
    const directory = join(repository, '.agent-docs', 'host-evals', 'evaluator', randomUUID());
    const wrapper = join(directory, 'capture.mjs');
    const command = [
      nodeBin,
      outerBin,
      'install',
      '--agent',
      'cursor',
      '--project',
      target,
      '--yes',
      '--json',
    ];
    const commandSha256 = digest(command.join('\0'));
    write(
      wrapper,
      `import { spawnSync } from 'node:child_process';\nconst command = ${JSON.stringify(command)};\nconst result = spawnSync(command[0], command.slice(1), { encoding: 'utf8', env: process.env, maxBuffer: 8 * 1024 * 1024 });\nconst status = Number.isInteger(result.status) ? result.status : 70;\nprocess.stdout.write(JSON.stringify({ version: 1, status, signal: result.signal ?? null, stdout: result.stdout ?? '', stderr: result.stderr ?? '', error: result.error?.message ?? null, commandSha256: ${JSON.stringify(commandSha256)} }));\nprocess.exit(status);\n`,
    );
    fixturePaths.captureWrapper = wrapper;
    fixturePaths.captureWrapperSha256 = fileDigest(wrapper);
    fixturePaths.captureCommand = command;
    fixturePaths.captureCommandSha256 = commandSha256;
    return wrapper;
  }
  return { setupVerifier, setupInstallCapture, verifierDigests, fixturePaths };
}
