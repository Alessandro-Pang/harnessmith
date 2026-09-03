import { join } from 'node:path';
import { adapterCapabilities } from '../../adapters/adapters.js';
import { initializeUserData } from '../../installation/user-data.js';
import type { Adapter, AgentName, PreparedInstall } from '../../shared/types.js';
import { errorMessage, HarnessmithError } from '../../shared/types.js';

const name = process.env.TEST_ADAPTER as AgentName;
const home = process.env.TEST_ADAPTER_HOME || '';
const adapter: Adapter = {
  name,
  label: name,
  home,
  harness: join(home, 'agent-harness'),
  record: join(home, '.harnessmith', 'install.json'),
  capabilities: adapterCapabilities(name),
  instructions: [],
};
const prepared: PreparedInstall = {
  adapter,
  stageRoot: join(home, '.unused-stage'),
  outputs: [],
  backups: [],
  installed: [],
  recordBackup: null,
  recordWritten: false,
  ignoreWritten: 0,
  ignoreSnapshots: [],
};

try {
  initializeUserData(prepared, process.env, { global: true });
} catch (error) {
  const failure =
    error instanceof HarnessmithError
      ? `${error.code}:${error.message}`
      : `INTERNAL_ERROR:${errorMessage(error)}`;
  process.stderr.write(`${failure}\n`);
  process.exitCode = error instanceof HarnessmithError ? error.exitCode : 1;
}
