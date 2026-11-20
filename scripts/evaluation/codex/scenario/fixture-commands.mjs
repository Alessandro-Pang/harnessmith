import { join } from 'node:path';
import { withEphemeralJsonPayload } from '../support/host.mjs';

/**
 * @param {import('./fixture-types.mjs').FixtureConfig} config
 * @param {ReturnType<typeof import('./fixture-workspace.mjs').createFixtureWorkspace>} workspace
 */
export function createFixtureCommands(config, workspace) {
  const { nodeBin, outerBin, repo, home, runRoot, commonRuntime } = config;
  const { checked } = commonRuntime;
  const { commonEnv } = workspace;
  function harnessBin() {
    // Runtime commands use the same global CLI and bundled Runtime as the installed Host skill.
    return outerBin;
  }
  function initProjectMemory() {
    checked(nodeBin, [harnessBin(), 'init', 'project', repo], {
      env: { ...commonEnv, HOME: home },
    });
  }
  function initGlobalMemory() {
    checked(nodeBin, [harnessBin(), 'init', 'global'], {
      env: { ...commonEnv, HOME: home },
    });
  }
  /** @param {string[]} args */
  function runHarness(args) {
    return checked(nodeBin, [harnessBin(), ...args], {
      cwd: repo,
      env: { ...commonEnv, HOME: home },
    });
  }
  let payloadSequence = 0;
  /** @param {string} command @param {unknown} payload */
  function harnessPayload(command, payload) {
    payloadSequence += 1;
    const path = join(runRoot, 'fixture-payloads', `${payloadSequence}-${command}.json`);
    return withEphemeralJsonPayload(path, payload, (payloadPath) =>
      runHarness([
        'memory',
        command,
        ...(command === 'handoff' ? [repo] : []),
        '--payload-file',
        payloadPath,
        '--json',
      ]),
    );
  }
  return { harnessBin, initProjectMemory, initGlobalMemory, runHarness, harnessPayload };
}
