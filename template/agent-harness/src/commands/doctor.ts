import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { shortDigest } from '../lib/files.js';
import { gitVersion } from '../lib/git.js';
import type { Io, Runtime } from '../types.js';

export function doctor(
  runtime: Runtime,
  { quietSuccess = false }: { quietSuccess?: boolean } = {},
  io: Io = console,
): void {
  const [major, minor] = process.versions.node
    .split('.')
    .slice(0, 2)
    .map((part) => Number.parseInt(part, 10));
  const version = gitVersion();
  const instructionFiles = runtime.instructionFiles;
  const checks: Array<[boolean, string]> = [
    [
      major > 24 || (major === 24 && minor >= 12),
      `Node.js ${process.versions.node} (required >= 24.12)`,
    ],
    [Boolean(version), version || 'Git is unavailable'],
    ...instructionFiles.map((path): [boolean, string] => [
      existsSync(path),
      `instructions ${path}`,
    ]),
    [existsSync(join(runtime.installedHarness, 'bin', 'harness.mjs')), 'installed harness CLI'],
    [existsSync(join(runtime.memoryHome, 'README.md')), `global memory ${runtime.memoryHome}`],
    [existsSync(join(runtime.memoryHome, 'core.md')), 'global memory core'],
    [existsSync(join(runtime.personalHome, 'AGENTS.md')), `personal rules ${runtime.personalHome}`],
  ];

  let failures = 0;
  for (const [passed, message] of checks) {
    if (!passed) failures += 1;
    if (!quietSuccess || !passed) io.log(`${passed ? 'OK' : 'FAIL'} ${message}`);
  }
  if (existsSync(instructionFiles[0]) && !quietSuccess) {
    io.log(`INFO instructions sha256 ${shortDigest(instructionFiles[0])}`);
  }
  if (failures > 0) throw new Error(`Doctor found ${failures} failure(s)`);
  if (!quietSuccess) io.log('Doctor passed');
}
