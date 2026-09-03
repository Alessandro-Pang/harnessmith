#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));
const candidates = [
  join(packageDir, 'dist', 'cli.js'),
  join(packageDir, '..', '..', 'dist', 'cli.js'),
];
const entry = candidates.find((path) => existsSync(path));
if (!entry) throw new Error('CLI bundle is missing; run pnpm run build');
const module = await import(pathToFileURL(entry).href);
if (typeof module.run !== 'function') throw new Error('CLI bundle does not export run');
try {
  process.exitCode = await module.run(process.argv.slice(2));
} catch (error) {
  if (!error?.commanderHandled) console.error(`ERROR ${error?.message ?? String(error)}`);
  process.exitCode = 1;
}
