import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { runCli } from '../cli.js';
import { doctor } from '../commands/doctor.js';
import { initGlobal, initPersonal } from '../commands/init.js';
import { validate } from '../commands/validate.js';
import { render } from '../lib/templates.js';
import { capturedIo, harnessRuntime, packageRoot, sourceHarnessRoot } from './helpers/harness.js';

function installedFixture() {
  const root = mkdtempSync(join(tmpdir(), 'harness-cli-unit-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const runtime = harnessRuntime(root);
  mkdirSync(runtime.harnessHome, { recursive: true });
  cpSync(sourceHarnessRoot, runtime.installedHarness, { recursive: true });
  const instructions = render(
    runtime,
    readFileSync(join(packageRoot, 'template', 'AGENTS.md'), 'utf8'),
  );
  writeFileSync(runtime.instructionFiles[0], instructions);
  initPersonal(runtime, capturedIo());
  initGlobal(runtime, capturedIo());
  return { root, runtime };
}

test('Harness CLI dispatches version and memory commands through injected IO', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-cli-dispatch-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const runtime = harnessRuntime(root);
  const version = capturedIo();
  assert.equal(runCli(['version'], { runtime, io: version }), 0);
  assert.deepEqual(version.logs, ['2.1.0']);
  assert.equal(runCli(['init', 'global'], { runtime, io: capturedIo() }), 0);
  assert.equal(runCli(['init', 'personal'], { runtime, io: capturedIo() }), 0);
  assert.equal(runCli(['memory', 'check', 'global'], { runtime, io: capturedIo() }), 0);
});

test('Harness version exposes its schema compatibility contract as JSON', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-version-contract-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const runtime = harnessRuntime(root);
  const output = capturedIo();

  assert.equal(runCli(['version', '--json'], { runtime, io: output }), 0);
  const contract = JSON.parse(output.logs[0]);
  assert.equal(contract.version, 1);
  assert.equal(contract.harnessVersion, '2.1.0');
  assert.equal(contract.schemaVersion, 1);
  assert.equal(contract.memorySchemaVersion, 1);
  assert.equal(contract.node, '>=24.12.0');
});

test('validation rejects an unsupported embedded memory schema version', () => {
  const { runtime } = installedFixture();
  const manifestPath = join(runtime.installedHarness, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.memorySchemaVersion = 99;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const output = capturedIo();

  assert.equal(validate(runtime, { json: true }, output), 1);
  const report = JSON.parse(output.logs[0]);
  assert.equal(report.valid, false);
  assert.equal(
    report.checks.some(
      (check: { id: string; status: string }) =>
        check.id === 'harness-manifest' && check.status === 'failed',
    ),
    true,
  );
});

test('Harness CLI exposes proposal-only memory promotion', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-memory-promote-cli-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, 'project');
  mkdirSync(join(project, '.agent-docs', 'distilled'), { recursive: true });
  writeFileSync(
    join(project, '.agent-docs', 'distilled', 'finding.md'),
    [
      '---',
      'title: Finding',
      'description: Expensive finding',
      'type: distilled-memory',
      'memory-kind: distilled',
      'status: active',
      'owners: [test-owner]',
      'created: 2026-08-19',
      'updated: 2026-08-19',
      'project: test',
      'tags: [test]',
      'scope: []',
      'source-refs: [docs/source.md]',
      'source-of-truth: false',
      'schema-version: 1',
      '---',
      '',
      '# Finding',
      '',
    ].join('\n'),
  );
  execFileSync('git', ['-C', project, 'init', '-q']);
  const runtime = harnessRuntime(root);
  const output = capturedIo();

  assert.equal(
    runCli(
      ['memory', 'promote', project, 'distilled/finding', '--target', 'docs/finding.md', '--json'],
      { runtime, io: output },
    ),
    0,
  );
  assert.equal(JSON.parse(output.logs[0]).mode, 'proposal-only');
  assert.equal(existsSync(join(project, 'docs', 'finding.md')), false);
});

test('doctor and validate pass for an installed fixture and report missing prerequisites', () => {
  const { root, runtime } = installedFixture();
  const healthy = capturedIo();
  doctor(runtime, {}, healthy);
  assert.match(healthy.logs.at(-1) ?? '', /Doctor passed/);

  const validation = capturedIo();
  assert.equal(validate(runtime, { json: true }, validation), 0);
  assert.equal((JSON.parse(validation.logs[0]) as { valid: boolean }).valid, true);

  const broken = harnessRuntime(join(root, 'broken'));
  assert.throws(() => doctor(broken, { quietSuccess: true }, capturedIo()), /failure/);

  rmSync(join(runtime.memoryHome, 'profile.md'));
  const missingProfile = capturedIo();
  assert.throws(() => doctor(runtime, { quietSuccess: true }, missingProfile), /failure/);
  assert.equal(
    missingProfile.logs.some((line) => /FAIL global user profile/.test(line)),
    true,
  );
});
