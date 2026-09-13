import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { shortDigest } from '../../lib/filesystem/files.js';
import { gitVersion } from '../../lib/filesystem/git.js';
import { validateInstructionPath } from '../../runtime.js';
import type { Io, Runtime } from '../../types.js';

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
      major > 22 || (major === 22 && minor >= 12),
      `Node.js ${process.versions.node} (required >= 22.12)`,
    ],
    [Boolean(version), version || 'Git is unavailable'],
    ...instructionFiles.map((path): [boolean, string] => {
      const pathCheck = validateInstructionPath(runtime.harnessHome, path);
      return [
        pathCheck.valid && existsSync(path),
        pathCheck.valid ? `instructions ${path}` : `instructions ${path}: ${pathCheck.reason}`,
      ];
    }),
    [existsSync(join(runtime.installedHarness, 'scripts', 'harness.mjs')), 'installed harness CLI'],
    [existsSync(join(runtime.memoryHome, 'README.md')), `global memory ${runtime.memoryHome}`],
    [existsSync(join(runtime.memoryHome, 'core.md')), 'global memory core'],
    [existsSync(join(runtime.memoryHome, 'profile.md')), 'global user profile'],
    [existsSync(join(runtime.personalHome, 'AGENTS.md')), `personal rules ${runtime.personalHome}`],
  ];

  let failures = 0;
  for (const [passed, message] of checks) {
    if (!passed) failures += 1;
    if (!quietSuccess || !passed) io.log(`${passed ? 'OK' : 'FAIL'} ${message}`);
  }
  if (
    instructionFiles.length > 0 &&
    validateInstructionPath(runtime.harnessHome, instructionFiles[0]).valid &&
    existsSync(instructionFiles[0]) &&
    !quietSuccess
  ) {
    io.log(`INFO instructions sha256 ${shortDigest(instructionFiles[0])}`);
  }
  if (failures > 0) throw new Error(`Doctor found ${failures} failure(s)`);
  if (!quietSuccess) io.log('Doctor passed');
}
