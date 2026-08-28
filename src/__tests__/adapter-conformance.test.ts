import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { adapterRegistry, type AgentName } from '../adapter-registry.js';
import { createAdapter } from '../adapters.js';
import { installAll } from '../install.js';
import { restoreAll, statusAll, uninstallAll } from '../lifecycle.js';
import { describeInstall } from '../records.js';
import type { Adapter } from '../types.js';

function fixture(prefix: string) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, 'project');
  mkdirSync(project, { recursive: true });
  const env = {
    ...process.env,
    HOME: root,
    CODEX_HOME: join(root, 'codex'),
    CLAUDE_CONFIG_DIR: join(root, 'claude'),
    OPENCODE_CONFIG_DIR: join(root, 'opencode'),
    HARNESS_MEMORY_HOME: join(root, 'memory'),
    HARNESS_PERSONAL_HOME: join(root, 'personal'),
    HARNESS_REPOSITORY_ROOT: join(root, 'repositories'),
    HARNESS_OWNER: 'adapter-conformance',
  };
  return { root, project, env };
}

function adapterFor(name: AgentName, env: NodeJS.ProcessEnv, project: string): Adapter {
  return createAdapter(name, { env, project });
}

function primaryInstruction(adapter: Adapter): string {
  const path = adapter.instructions[0]?.path;
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
    assert.equal(existsSync(adapter.home), false);
    assert.equal(existsSync(adapter.record), false);
  });

  test(`conformance ${entry.name}: install, status, upgrade, restore, and uninstall`, () => {
    const { project, env } = fixture(`harnessmith-conform-life-${entry.name}-`);
    const adapter = adapterFor(entry.name, env, project);

    assert.equal(statusAll([adapter])[0].installed, false);
    assert.equal(existsSync(adapter.home), false);

    installAll([adapter], { env, noInitGlobal: true });
    const afterInstall = statusAll([adapter])[0];
    assert.equal(afterInstall.installed, true);
    assert.equal(
      afterInstall.outputs.every(({ status }) => status === 'managed'),
      true,
    );
    assert.ok(existsSync(adapter.record));
    assert.ok(existsSync(adapter.harness));

    installAll([adapter], { env, noInitGlobal: true });
    assert.equal(
      statusAll([adapter])[0].outputs.every(({ status }) => status === 'managed'),
      true,
    );
    assert.ok(existsSync(adapter.record));

    const restored = restoreAll([adapter]);
    assert.equal(restored[0].adapter, entry.name);
    assert.ok(existsSync(adapter.record));

    const uninstalled = uninstallAll([adapter]);
    assert.equal(uninstalled[0].adapter, entry.name);
    assert.equal(existsSync(adapter.record), false);
    assert.equal(existsSync(adapter.harness), false);
    assert.equal(statusAll([adapter])[0].installed, false);
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

test('conformance multi-adapter: preflight rejects a modified peer without mutating others', () => {
  const { project, env } = fixture('harnessmith-conform-multi-preflight-');
  const adapters = adapterRegistry.map(({ name }) => adapterFor(name, env, project));
  installAll(adapters, { env, noInitGlobal: true });

  const victim = adapters[0];
  const peer = adapters[1];
  assert.ok(victim && peer);
  const instruction = primaryInstruction(victim);
  writeFileSync(instruction, `${readFileSync(instruction, 'utf8')}\nuser edit\n`);

  const peerRecordBefore = readFileSync(peer.record, 'utf8');
  const peerHarnessBefore = existsSync(peer.harness);

  assert.throws(() => uninstallAll(adapters), /modified/);
  assert.ok(existsSync(victim.record));
  assert.ok(existsSync(peer.record));
  assert.equal(readFileSync(peer.record, 'utf8'), peerRecordBefore);
  assert.equal(existsSync(peer.harness), peerHarnessBefore);
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
  assert.ok(existsSync(second.harness));
  assert.deepEqual(
    readdirSync(second.home).filter((name) => name.startsWith('.harnessmith-restore-')),
    [],
  );
  assert.ok(existsSync(root));
});
