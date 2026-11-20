import { createFixtureCapture } from './fixture-capture.mjs';
import { createFixtureCommands } from './fixture-commands.mjs';
import { createFixtureWorkspace } from './fixture-workspace.mjs';

/** @param {import('./fixture-types.mjs').FixtureConfig} config */
export function createFixtureBase(config) {
  const workspace = createFixtureWorkspace(config);
  const commands = createFixtureCommands(config, workspace);
  const capture = createFixtureCapture(config);
  return { ...config.commonRuntime, ...workspace, ...commands, ...capture };
}
