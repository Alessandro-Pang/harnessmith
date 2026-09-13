import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { doctor } from '../commands/health/doctor.js';
import { validate } from '../commands/validate.js';
import { installationHealth } from '../lib/health/health-installation.js';
import { resolveRuntimeIdentity } from '../runtime.js';
import { capturedIo, harnessRuntime } from './helpers/harness.js';

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'harness-instruction-path-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test('runtime identity rejects a dangling instruction symlink inside the managed home', () => {
  const root = temporaryRoot();
  const harnessHome = join(root, 'host');
  const harnessRoot = join(harnessHome, 'skills', 'agent-harness');
  const instruction = join(harnessHome, 'entry', 'AGENTS.md');
  mkdirSync(harnessRoot, { recursive: true });
  mkdirSync(dirname(instruction), { recursive: true });
  symlinkSync(join(root, 'removed', 'AGENTS.md'), instruction);
  writeFileSync(
    join(harnessRoot, 'install-context.json'),
    JSON.stringify({
      version: 2,
      harnessHome,
      agentsHome: join(root, 'agents'),
      instructionFiles: [instruction],
      stateHome: join(harnessHome, 'state'),
      memoryHome: join(root, 'memory'),
      personalHome: join(root, 'personal'),
      repositoryRoot: join(root, 'repositories'),
      owner: 'test-owner',
    }),
  );

  assert.equal(resolveRuntimeIdentity(harnessRoot).kind, 'invalid');
});

test('doctor and validate reject dangling instruction symlinks', () => {
  const root = temporaryRoot();
  const runtime = harnessRuntime(root);
  const instruction = runtime.instructionFiles[0];
  mkdirSync(runtime.installedHarness, { recursive: true });
  mkdirSync(dirname(instruction), { recursive: true });
  writeFileSync(instruction, '# rules\n');
  rmSync(instruction);
  symlinkSync(join(runtime.harnessHome, 'removed', 'AGENTS.md'), instruction);

  const validation = capturedIo();
  assert.equal(validate(runtime, { json: true }, validation), 1);
  const report = JSON.parse(validation.logs[0]) as {
    checks: Array<{ id: string; status: string; message: string }>;
  };
  assert.equal(
    report.checks.some(
      (check) =>
        check.id === 'instructions' &&
        check.status === 'failed' &&
        /symbolic link/i.test(check.message),
    ),
    true,
  );

  const doctorIo = capturedIo();
  assert.throws(() => doctor(runtime, {}, doctorIo), /failure/);
  assert.equal(
    doctorIo.logs.some((line) => /FAIL instructions .*symbolic link/i.test(line)),
    true,
  );
});

test('installation health reports unsafe instruction paths', () => {
  const root = temporaryRoot();
  const runtime = harnessRuntime(root);
  const instruction = runtime.instructionFiles[0];
  mkdirSync(join(runtime.installedHarness, 'scripts'), { recursive: true });
  writeFileSync(join(runtime.installedHarness, 'scripts', 'harness.mjs'), '#!/usr/bin/env node\n');
  writeFileSync(
    join(runtime.installedHarness, 'manifest.json'),
    JSON.stringify({ schemaVersion: 3, memorySchemaVersion: 1 }),
  );
  mkdirSync(runtime.personalHome, { recursive: true });
  writeFileSync(join(runtime.personalHome, 'AGENTS.md'), '# personal\n');
  mkdirSync(dirname(instruction), { recursive: true });
  symlinkSync(join(runtime.harnessHome, 'removed', 'AGENTS.md'), instruction);

  const check = installationHealth(runtime);
  assert.equal(check.status, 'failed');
  assert.equal(
    check.details?.some((detail) => /symbolic link/i.test(detail)),
    true,
  );
});
