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
import { createAdapter } from '../adapters/adapters.js';
import { installAll } from '../installation/install.js';
import { isLegacyLayoutRecord } from '../installation/layout-migration.js';
import { restoreAll, statusAll, uninstallAll } from '../installation/lifecycle.js';
import {
  describeInstall,
  digestManagedOutput,
  readInstallRecord,
} from '../installation/records.js';
import { digestPath } from '../shared/files.js';
import type { Adapter } from '../shared/types.js';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-legacy-layout-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const env = {
    ...process.env,
    HOME: root,
    CODEX_HOME: join(root, 'codex'),
    HARNESS_REPOSITORY_ROOT: join(root, 'repositories'),
    HARNESS_OWNER: 'legacy-layout',
  };
  for (const key of ['HARNESS_HOME', 'HARNESS_MEMORY_HOME', 'HARNESS_PERSONAL_HOME']) {
    delete (env as NodeJS.ProcessEnv)[key];
  }
  return { root, env, adapter: createAdapter('codex', { env }) };
}

/**
 * Lays down the pre-hub on-disk shape written by 0.x/1.x installers: a full Harness copy in
 * the host home, a rendered instruction file, a v1 record pointing at both, and the shared
 * user data at `~/.agent-harness` / `~/.agent-docs`.
 */
function writeLegacyInstall(adapter: Adapter): void {
  const { hub } = adapter;
  const instruction = adapter.instructions[0].path;
  mkdirSync(join(adapter.legacyHarness, 'state'), { recursive: true });
  mkdirSync(join(adapter.legacyHarness, 'scripts'), { recursive: true });
  writeFileSync(join(adapter.legacyHarness, 'marker.txt'), 'legacy copy\n');
  writeFileSync(join(adapter.legacyHarness, 'scripts', 'harness.mjs'), '// legacy\n');
  writeFileSync(join(adapter.legacyHarness, 'state', 'task.json'), '{"checkpoint":1}\n');
  mkdirSync(dirname(instruction), { recursive: true });
  writeFileSync(instruction, '<!-- managed-by: harnessmith -->\n# legacy rules\n');
  mkdirSync(hub.legacyRules, { recursive: true });
  writeFileSync(join(hub.legacyRules, 'AGENTS.md'), '# my personal rules\n');
  mkdirSync(hub.legacyMemory, { recursive: true });
  writeFileSync(join(hub.legacyMemory, 'core.md'), '# my memory\n');
  mkdirSync(dirname(adapter.record), { recursive: true });
  writeFileSync(
    adapter.record,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        adapter: adapter.name,
        packageVersion: '0.9.0',
        outputs: [
          {
            path: adapter.legacyHarness,
            checksum: digestManagedOutput(adapter, adapter.legacyHarness),
            backup: null,
          },
          { path: instruction, checksum: digestPath(instruction), backup: null },
        ],
        ignoreFiles: [],
        recordBackup: null,
      },
      null,
      2,
    )}\n`,
  );
}

function backupsBeside(path: string): string[] {
  const name = `${path.split('/').at(-1)}.backup-`;
  return readdirSync(dirname(path)).filter((entry) => entry.startsWith(name));
}

test('pre-hub records stay readable and report the pending layout migrations', () => {
  const { adapter } = fixture();
  writeLegacyInstall(adapter);

  const record = readInstallRecord(adapter);
  assert.ok(record);
  assert.equal(isLegacyLayoutRecord(record), true);
  const status = statusAll([adapter])[0];
  assert.equal(status.installed, true);
  assert.equal(status.hub.installed, false);
  assert.equal(
    status.outputs.every(({ status: state }) => state === 'managed'),
    true,
  );

  const plan = describeInstall(adapter);
  assert.deepEqual(plan.migrations, [
    { path: adapter.hub.legacyRules, action: 'migrate-user-data' },
    { path: adapter.hub.legacyMemory, action: 'migrate-user-data' },
    { path: adapter.legacyHarness, action: 'migrate-legacy-layout' },
  ]);
  assert.equal(
    plan.outputs.find(({ path }) => path === adapter.hub.harness)?.action,
    'create',
    'the hub skill is not yet owned',
  );
  assert.equal(
    plan.outputs.find(({ path }) => path === adapter.instructions[0].path)?.action,
    'replace-managed',
  );
});

test('upgrading a pre-hub install builds the hub, seeds state and user data, and records the moves', () => {
  const { adapter } = fixture();
  const { hub } = adapter;
  writeLegacyInstall(adapter);
  const env = { ...process.env, HOME: hub.userHome, CODEX_HOME: adapter.home };

  const [result] = installAll([adapter], { env, noInitGlobal: true });

  assert.deepEqual(result?.migrations, [
    { path: hub.legacyRules, action: 'migrate-user-data' },
    { path: hub.legacyMemory, action: 'migrate-user-data' },
    { path: adapter.legacyHarness, action: 'migrate-legacy-layout' },
  ]);
  assert.ok(existsSync(join(hub.harness, 'SKILL.md')));
  assert.equal(lstatSync(adapter.instructions[0].path).isSymbolicLink(), true);
  assert.equal(readFileSync(join(hub.state, 'task.json'), 'utf8'), '{"checkpoint":1}\n');
  assert.equal(readFileSync(join(hub.rules, 'AGENTS.md'), 'utf8'), '# my personal rules\n');
  assert.equal(readFileSync(join(hub.memory, 'core.md'), 'utf8'), '# my memory\n');
  for (const legacy of [adapter.legacyHarness, hub.legacyRules, hub.legacyMemory]) {
    assert.equal(existsSync(legacy), false, legacy);
    assert.equal(backupsBeside(legacy).length, 1, legacy);
  }

  const adapterRecord = readInstallRecord(adapter);
  assert.ok(adapterRecord);
  assert.equal(isLegacyLayoutRecord(adapterRecord), false);
  assert.deepEqual(adapterRecord.migratedOutputs, [
    {
      path: adapter.legacyHarness,
      backup: join(adapter.home, backupsBeside(adapter.legacyHarness)[0]),
    },
  ]);
  const hubRecord = readInstallRecord(hub);
  assert.ok(hubRecord);
  assert.deepEqual(hubRecord.owners, ['codex']);
  assert.deepEqual(
    hubRecord.migratedOutputs?.map(({ path }) => path),
    [hub.legacyRules, hub.legacyMemory],
  );
  assert.equal(
    statusAll([adapter])[0].outputs.every(({ status }) => status === 'managed'),
    true,
  );
});

test('restore puts the pre-hub layout and user data back where the previous record expects them', () => {
  const { adapter } = fixture();
  const { hub } = adapter;
  writeLegacyInstall(adapter);
  const legacyRecord = readFileSync(adapter.record, 'utf8');
  const env = { ...process.env, HOME: hub.userHome, CODEX_HOME: adapter.home };

  installAll([adapter], { env, noInitGlobal: true });
  const restored = restoreAll([adapter]);

  assert.equal(restored[0].hub, 'unwind');
  assert.equal(existsSync(hub.record), false);
  assert.equal(existsSync(hub.harness), false);
  assert.equal(existsSync(hub.discoveryLink), false);
  assert.equal(readFileSync(join(adapter.legacyHarness, 'marker.txt'), 'utf8'), 'legacy copy\n');
  assert.equal(readFileSync(join(hub.legacyRules, 'AGENTS.md'), 'utf8'), '# my personal rules\n');
  assert.equal(readFileSync(join(hub.legacyMemory, 'core.md'), 'utf8'), '# my memory\n');
  assert.equal(lstatSync(adapter.instructions[0].path).isSymbolicLink(), false);
  for (const legacy of [adapter.legacyHarness, hub.legacyRules, hub.legacyMemory]) {
    assert.deepEqual(backupsBeside(legacy), [], legacy);
  }
  assert.equal(readFileSync(adapter.record, 'utf8'), legacyRecord);
  assert.equal(isLegacyLayoutRecord(readInstallRecord(adapter)), true);
  assert.ok(existsSync(hub.rules), 'seeded user data is never deleted');
});

test('uninstall unwinds a migrated layer, the pre-hub layer beneath it, and the hub', () => {
  const { adapter } = fixture();
  const { hub } = adapter;
  writeLegacyInstall(adapter);
  const env = { ...process.env, HOME: hub.userHome, CODEX_HOME: adapter.home };
  installAll([adapter], { env, noInitGlobal: true });

  const result = uninstallAll([adapter]);

  assert.equal(result[0].layers, 2);
  assert.equal(result[0].hub, 'unwind');
  assert.equal(existsSync(adapter.record), false);
  assert.equal(existsSync(adapter.instructions[0].path), false);
  assert.equal(existsSync(adapter.legacyHarness), false);
  assert.equal(existsSync(hub.record), false);
  assert.equal(existsSync(hub.harness), false);
  assert.deepEqual(backupsBeside(adapter.legacyHarness), []);
  assert.equal(statusAll([adapter])[0].installed, false);
});

test('an unrecorded agent-harness directory in the host home is user content, not a migration', () => {
  const { env, adapter } = fixture();
  mkdirSync(adapter.legacyHarness, { recursive: true });
  writeFileSync(join(adapter.legacyHarness, 'notes.md'), 'not managed by harnessmith\n');

  assert.deepEqual(describeInstall(adapter).migrations, []);
  installAll([adapter], { env, noInitGlobal: true });

  assert.equal(
    readFileSync(join(adapter.legacyHarness, 'notes.md'), 'utf8'),
    'not managed by harnessmith\n',
  );
  assert.deepEqual(backupsBeside(adapter.legacyHarness), []);
  assert.equal(readInstallRecord(adapter)?.migratedOutputs, undefined);
});
