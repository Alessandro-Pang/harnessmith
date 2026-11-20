import { join } from 'node:path';
import { initializeUserData } from '../../installation/user-data.js';
import { resolveUserData } from '../../installation/user-data-paths.js';
import { errorMessage, HarnessmithError } from '../../shared/types.js';

const home = process.env.TEST_ADAPTER_HOME || '';

try {
  initializeUserData(resolveUserData(process.env), process.env, {
    global: true,
    runtimeEntry: join(home, 'harness.mjs'),
  });
} catch (error) {
  const failure =
    error instanceof HarnessmithError
      ? `${error.code}:${error.message}`
      : `INTERNAL_ERROR:${errorMessage(error)}`;
  process.stderr.write(`${failure}\n`);
  process.exitCode = error instanceof HarnessmithError ? error.exitCode : 1;
}
