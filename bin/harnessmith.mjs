#!/usr/bin/env node

import { run } from '../dist/cli.js';

try {
  process.exitCode = await run(process.argv.slice(2));
} catch (error) {
  if (!error.commanderHandled) console.error(`ERROR ${error.message}`);
  process.exitCode = 1;
}
