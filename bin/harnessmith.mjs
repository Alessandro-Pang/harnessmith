#!/usr/bin/env node

import { run } from '../dist/cli.js';
import { machineErrorReport } from '../dist/shared/errors.js';

try {
  process.exitCode = await run(process.argv.slice(2));
} catch (error) {
  const report = machineErrorReport(error);
  const commandError = /** @type {Error & { commanderHandled?: boolean }} */ (error);
  if (!commandError.commanderHandled) console.error(`ERROR ${report.error.message}`);
  process.exitCode = report.error.exitCode;
}
