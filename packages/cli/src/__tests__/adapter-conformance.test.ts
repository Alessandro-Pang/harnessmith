import assert from 'node:assert/strict';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { elementAt } from '../../../../packages/harness/src/__tests__/helpers/harness.js';
import { type AgentName, adapterRegistry } from '../adapters/adapter-registry.js';
import { createAdapter } from '../adapters/adapters.js';
import { installAll } from '../installation/install.js';
import { restoreAll, uninstallAll } from '../installation/lifecycle.js';
import { describeInstall, readInstallRecord } from '../installation/records.js';
import type { Adapter } from '../shared/types.js';
import { statusAll } from '../status/status-inspection.js';

function fixture(prefix: string) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, 'project');
  mkdirSync(project, { recursive: true });
  const env = {
    ...process.env,
    HOME: root,
    APPDATA: join(root, 'appdata'),
    CODEX_HOME: join(root, 'codex'),
    CLAUDE_CONFIG_DIR: join(root, 'claude'),
    OPENCODE_CONFIG_DIR: join(root, 'opencode'),
    KIMI_CODE_HOME: join(root, 'kimi'),
    HARNESS_MEMORY_HOME: join(root, 'memory'),
    HARNESS_PERSONAL_HOME: join(root, 'personal'),
    HARNESS_REPOSITORY_ROOT: join(root, 'repositories'),
    HARNESS_OWNER: 'adapter-conformance',
  };
  for (const key of ['HARNESS_HOME', 'HARNESS_STATE_HOME']) {
    delete (env as NodeJS.ProcessEnv)[key];
  }
  return { root, project, env };
}

function adapterFor(name: AgentName, env: NodeJS.ProcessEnv, project: string): Adapter {
  return createAdapter(name, { env, project });
}

function primaryInstruction(adapter: Adapter): string {
  const path = elementAt(adapter.instructions, 0)?.path;
  assert.ok(path, `${adapter.name} is missing a primary instruction file`);
  return path;
}

for (const entry of adapterRegistry) {
  test(`conformance ${entry.name}: dry-run describes outputs without creating the agent home`, () => {
    const { project, env } = fixture(`harnessmith-conform-dry-${entry.name}-`);
    const adapter = adapterFor(entry.name, env, project);
    const plan = describeInstall(adapter);

    assert.equal(plan.adapter, entry.name);
    assert.deepEqual(plan.capabilities, entry.capabilities);
    assert.ok(plan.outputs.length > 0);
    assert.ok(plan.outputs.every((output) => output.action === 'create'));
    assert.deepEqual(plan.userData, adapter.userData);
    assert.equal(existsSync(adapter.home), false);
    assert.equal(existsSync(adapter.record), false);
  });

  test(`conformance ${entry.name}: install, status, upgrade, restore, and uninstall`, () => {
    const { root, project, env } = fixture(`harnessmith-conform-life-${entry.name}-`);
    const adapter = adapterFor(entry.name, env, project);

    assert.equal(elementAt(statusAll([adapter]), 0).installed, false);
    assert.equal(existsSync(adapter.home), false);

    installAll([adapter], { env, noInitGlobal: true });
    const afterInstall = elementAt(statusAll([adapter]), 0);
    assert.equal(afterInstall.installed, true);
    assert.equal(
      afterInstall.outputs.every(({ status }) => status === 'managed'),
      true,
    );
    assert.ok(existsSync(adapter.record));
    assert.equal(lstatSync(primaryInstruction(adapter)).isSymbolicLink(), false);
    assert.match(readFileSync(primaryInstruction(adapter), 'utf8'), /managed-by: harnessmith/);
    const record = readInstallRecord(adapter);
    assert.equal(record?.schemaVersion, 3);
    assert.equal(record?.adapter, entry.name);
    assert.equal(
      existsSync(join(adapter.userData.home, '.harnessmith', 'install.json')),
      false,
      'user data is not a managed scope and carries no record',
    );
    assert.equal(existsSync(join(adapter.home, 'skills', 'agent-harness')), false);
    assert.equal(
      existsSync(join(adapter.userData.home, 'dist')),
      false,
      'no Runtime copy in user data',
    );
    assert.equal(existsSync(join(adapter.userData.home, 'scripts')), false);

    installAll([adapter], { env, noInitGlobal: true });
    assert.equal(
      elementAt(statusAll([adapter]), 0).outputs.every(({ status }) => status === 'managed'),
      true,
    );
    assert.ok(existsSync(adapter.record));
    assert.ok(readInstallRecord(adapter)?.recordBackup, 'the upgrade keeps the previous layer');

    const restored = restoreAll([adapter]);
    assert.equal(elementAt(restored, 0).adapter, entry.name);
    assert.ok(existsSync(adapter.record));

    const uninstalled = uninstallAll([adapter]);
    assert.equal(elementAt(uninstalled, 0).adapter, entry.name);
    assert.equal(existsSync(adapter.record), false);
    assert.equal(existsSync(primaryInstruction(adapter)), false);
    assert.ok(
      existsSync(join(root, 'personal')),
      'personal rules are user data and survive uninstall',
    );
    assert.equal(elementAt(statusAll([adapter]), 0).installed, false);
  });

  test(`conformance ${entry.name}: refuses unmanaged conflicts without force`, () => {
    const { project, env } = fixture(`harnessmith-conform-conflict-${entry.name}-`);
    const adapter = adapterFor(entry.name, env, project);
    const instruction = primaryInstruction(adapter);
    mkdirSync(dirname(instruction), { recursive: true });
    writeFileSync(instruction, 'unmanaged personal rules\n');

    assert.throws(() => installAll([adapter], { env, noInitGlobal: true }), /require --force/);
    assert.equal(readFileSync(instruction, 'utf8'), 'unmanaged personal rules\n');
    assert.equal(existsSync(adapter.record), false);

    installAll([adapter], { env, force: true, noInitGlobal: true });
    assert.match(readFileSync(instruction, 'utf8'), /managed-by: harnessmith/);
    assert.ok(existsSync(adapter.record));
  });
}

test('schema 3 installation records reject unknown fields', () => {
  const { project, env } = fixture('harnessmith-conform-record-');
  const adapter = adapterFor('codex', env, project);
  installAll([adapter], { env, noInitGlobal: true });
  const record = JSON.parse(readFileSync(adapter.record, 'utf8')) as Record<string, unknown>;
  writeFileSync(adapter.record, JSON.stringify({ ...record, unexpected: true }));

  assert.throws(() => readInstallRecord(adapter), /invalid installation-record shape/);
});

test('conformance multi-adapter: install preflight rejects a conflicted peer before committing any adapter', () => {
  const { project, env } = fixture('harnessmith-conform-multi-install-preflight-');
  const first = adapterFor('codex', env, project);
  const second = adapterFor('claude', env, project);
  const peerInstruction = primaryInstruction(second);
  mkdirSync(dirname(peerInstruction), { recursive: true });
  writeFileSync(peerInstruction, 'unmanaged peer rules\n');

  assert.throws(() => installAll([first, second], { env, noInitGlobal: true }), /require --force/);
  assert.equal(
    existsSync(first.record),
    false,
    'no adapter layer is committed before preflight passes',
  );
  assert.equal(existsSync(primaryInstruction(first)), false);
  assert.equal(readFileSync(peerInstruction, 'utf8'), 'unmanaged peer rules\n');
  assert.equal(existsSync(join(first.userData.home, '.harnessmith', 'install.json')), false);
});

test('conformance multi-adapter: preflight rejects a modified peer without mutating others', () => {
  const { project, env } = fixture('harnessmith-conform-multi-preflight-');
  const adapters = adapterRegistry.map(({ name }) => adapterFor(name, env, project));
  installAll(adapters, { env, noInitGlobal: true });

  const victim = elementAt(adapters, 0);
  const peer = elementAt(adapters, 1);
  assert.ok(victim && peer);
  const instruction = primaryInstruction(victim);
  writeFileSync(instruction, `${readFileSync(instruction, 'utf8')}\nuser edit\n`);

  const peerRecordBefore = readFileSync(peer.record, 'utf8');
  const peerInstruction = primaryInstruction(peer);
  const peerInstructionBefore = readFileSync(peerInstruction, 'utf8');

  assert.throws(() => uninstallAll(adapters), /modified/);
  assert.ok(existsSync(victim.record));
  assert.ok(existsSync(peer.record));
  assert.equal(readFileSync(peer.record, 'utf8'), peerRecordBefore);
  assert.equal(lstatSync(peerInstruction).isSymbolicLink(), false);
  assert.equal(readFileSync(peerInstruction, 'utf8'), peerInstructionBefore);
});

test('conformance multi-adapter: later failure rolls back earlier adapter mutations', () => {
  const { root, project, env } = fixture('harnessmith-conform-multi-rollback-');
  const first = adapterFor('codex', env, project);
  const second = adapterFor('cursor', env, project);
  installAll([first, second], { env, noInitGlobal: true });

  const firstRecordBefore = readFileSync(first.record, 'utf8');
  const firstRules = primaryInstruction(first);
  const firstRulesBefore = readFileSync(firstRules, 'utf8');
  const cursorIgnore = second.localIgnoreFiles?.at(-1)?.path;
  assert.ok(cursorIgnore);
  rmSync(cursorIgnore);
  mkdirSync(cursorIgnore);

  assert.throws(() => uninstallAll([first, second]));

  assert.equal(readFileSync(first.record, 'utf8'), firstRecordBefore);
  assert.equal(readFileSync(firstRules, 'utf8'), firstRulesBefore);
  assert.ok(existsSync(second.record));
  assert.equal(lstatSync(primaryInstruction(second)).isSymbolicLink(), false);
  assert.equal(existsSync(join(first.userData.home, '.harnessmith', 'install.json')), false);
  assert.deepEqual(
    readdirSync(second.home).filter((name) => name.startsWith('.harnessmith-restore-')),
    [],
  );
  assert.ok(existsSync(root));
});
