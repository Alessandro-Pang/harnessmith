#!/usr/bin/env node

import { runCli } from '../dist/harness.mjs';

try {
  process.exitCode = runCli(process.argv.slice(2));
} catch (error) {
  if (!error.commanderHandled) console.error(`ERROR ${error.message}`);
  process.exitCode = 1;
}
