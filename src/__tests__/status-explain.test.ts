import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { onTestFinished, test } from 'vitest';
import { createAdapter } from '../adapters/adapters.js';
import { installAll } from '../installation/install.js';
import { inspectStatusAll } from '../installation/lifecycle.js';
import { explainStatus } from '../status/status-explanation.js';

const packageRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const cli = join(packageRoot, 'bin', 'harnessmith.mjs');

function fixture(prefix: string) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const env = {
    ...process.env,
    HOME: root,
    CODEX_HOME: join(root, 'codex-home'),
    HARNESS_MEMORY_HOME: join(root, 'agent-docs'),
    HARNESS_PERSONAL_HOME: join(root, 'personal-harness'),
    HARNESS_REPOSITORY_ROOT: root,
    HARNESS_OWNER: 'status-explain-test',
  };
  return { root, env, adapter: createAdapter('codex', { env }) };
}

test('status explanation classifies missing and unmanaged targets without writing', () => {
  const { adapter } = fixture('harnessmith-status-uninstalled-');
  const missing = explainStatus(inspectStatusAll([adapter])[0]);
  assert.equal(missing.observedState, 'missing');
  assert.equal(missing.reasonCode, 'INSTALLATION_MISSING');
  assert.equal(missing.actions[0].code, 'SETUP_PREVIEW');
  assert.ok(missing.actions.every(({ automatic }) => automatic === false));
  assert.equal(existsSync(adapter.home), false);

  mkdirSync(adapter.home, { recursive: true });
  writeFileSync(adapter.instructions[0].path, 'unmanaged instructions\n');
  const unmanaged = explainStatus(inspectStatusAll([adapter])[0]);
  assert.equal(unmanaged.observedState, 'unmanaged');
  assert.equal(unmanaged.reasonCode, 'UNMANAGED_TARGETS');
  assert.ok(unmanaged.actions.some(({ code }) => code === 'INSPECT_OWNERSHIP'));
  assert.equal(readFileSync(adapter.instructions[0].path, 'utf8'), 'unmanaged instructions\n');
  assert.ok(unmanaged.stateDefinitions.unsupported);
});

test('status explanation reports managed, modified, partial, and backup evidence', () => {
  const { env, adapter } = fixture('harnessmith-status-installed-');
  mkdirSync(adapter.home, { recursive: true });
  writeFileSync(adapter.instructions[0].path, 'original instructions\n');
  installAll([adapter], { env, force: true, noInitGlobal: true });

  const managed = explainStatus(inspectStatusAll([adapter])[0]);
  assert.equal(managed.observedState, 'managed');
  assert.equal(managed.reasonCode, 'MANAGED_INSTALLATION');
  assert.ok(managed.evidence.backups.some(({ state }) => state === 'present'));
  assert.equal(managed.boundaries.hostBehavior.conclusion, 'inconclusive');
  assert.equal(managed.boundaries.hostBehavior.state, 'host-dependent');

  writeFileSync(adapter.instructions[0].path, 'user-modified instructions\n');
  const modified = explainStatus(inspectStatusAll([adapter])[0]);
  assert.equal(modified.observedState, 'modified');
  assert.equal(modified.reasonCode, 'MANAGED_OUTPUT_MODIFIED');
  assert.ok(modified.actions.some(({ code }) => code === 'INSPECT_DIFF'));

  rmSync(adapter.harness, { recursive: true });
  const partial = explainStatus(inspectStatusAll([adapter])[0]);
  assert.equal(partial.observedState, 'partial');
  assert.equal(partial.reasonCode, 'PARTIAL_INSTALLATION');
  assert.ok(partial.actions.some(({ code }) => code === 'RESTORE_PREVIEW'));
});

test('status explain JSON and text share state, reason, and safe next action semantics', () => {
  const { root, env } = fixture('harnessmith-status-cli-');
  const adapter = createAdapter('codex', { env });
  installAll([adapter], { env, noInitGlobal: true });
  const baseArgs = ['status', '--agent', 'codex', '--explain'];
  const json = spawnSync(process.execPath, [cli, ...baseArgs, '--json'], {
    cwd: root,
    env,
    encoding: 'utf8',
  });
  const text = spawnSync(process.execPath, [cli, ...baseArgs], {
    cwd: root,
    env,
    encoding: 'utf8',
  });

  assert.equal(json.status, 0, json.stderr);
  assert.equal(text.status, 0, text.stderr);
  const report = JSON.parse(json.stdout);
  assert.equal(report.observedState, 'managed');
  assert.match(text.stdout, new RegExp(report.observedState));
  assert.match(text.stdout, new RegExp(report.reasonCode));
  assert.match(text.stdout, new RegExp(report.actions[0].code));
  assert.match(text.stdout, /not executed automatically/i);
  assert.doesNotMatch(text.stdout, /automatic=true/i);
  assert.match(
    text.stdout,
    /First Value: installed=passed, healthy=not-checked, host-configured=inconclusive, host-verified=inconclusive/,
  );
  assert.match(text.stdout, /First Value next RUN_DIAGNOSTICS/);
});

test('status explain reports unsupported adapters without resolving or writing paths', () => {
  const { root, env } = fixture('harnessmith-status-unsupported-');
  const result = spawnSync(
    process.execPath,
    [cli, 'status', '--agent', 'windsurf', '--explain', '--json'],
    { cwd: root, env, encoding: 'utf8' },
  );

  assert.equal(result.status, 2);
  assert.equal(result.stderr, '');
  const report = JSON.parse(result.stdout);
  assert.equal(report.observedState, 'unsupported');
  assert.equal(report.reasonCode, 'ADAPTER_UNSUPPORTED');
  assert.equal(report.actions[0].code, 'LIST_SUPPORTED_ADAPTERS');
  assert.equal(existsSync(join(root, 'codex-home')), false);
});
