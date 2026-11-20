import { existsSync, writeFileSync } from 'node:fs';
import { hostAdapter } from '../../adapters/host-adapter.js';
import { installAll } from '../../installation/install.js';
import { uninstallAll } from '../../installation/lifecycle.js';
import { resolveUserData } from '../../installation/user-data-paths.js';
import { errorMessage, HarnessmithError } from '../../shared/types.js';

const home = process.env.TEST_ADAPTER_HOME || '';
const entered = process.env.TEST_ENTERED || '';
const release = process.env.TEST_RELEASE || '';

async function waitForSkillsPhase(): Promise<boolean> {
  const deadline = Date.now() + 15_000;
  while (!existsSync(entered)) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return true;
}

try {
  if (!(await waitForSkillsPhase())) {
    process.stderr.write('BARRIER_TIMEOUT:contender never saw the skills phase\n');
    process.exitCode = 24;
  } else {
    const adapter = hostAdapter('codex', home, resolveUserData(process.env));
    if (process.env.TEST_COMMAND === 'uninstall') uninstallAll([adapter]);
    else installAll([adapter], { env: process.env, noInitGlobal: true });
  }
} catch (error) {
  const failure =
    error instanceof HarnessmithError
      ? `${error.code}:${error.message}`
      : `INTERNAL_ERROR:${errorMessage(error)}`;
  process.stderr.write(`${failure}\n`);
  process.exitCode = error instanceof HarnessmithError ? error.exitCode : 1;
} finally {
  writeFileSync(release, 'release');
}
