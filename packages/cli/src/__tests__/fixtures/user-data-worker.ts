import { resolveHub } from '../../installation/hub.js';
import { initializeUserData } from '../../installation/user-data.js';
import { errorMessage, HarnessmithError } from '../../shared/types.js';

const home = process.env.TEST_ADAPTER_HOME || '';
const hub = resolveHub({ ...process.env, HARNESS_HOME: home });

try {
  initializeUserData(hub, process.env, { global: true });
} catch (error) {
  const failure =
    error instanceof HarnessmithError
      ? `${error.code}:${error.message}`
      : `INTERNAL_ERROR:${errorMessage(error)}`;
  process.stderr.write(`${failure}\n`);
  process.exitCode = error instanceof HarnessmithError ? error.exitCode : 1;
}
