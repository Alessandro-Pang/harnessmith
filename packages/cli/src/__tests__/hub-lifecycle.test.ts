import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { createAdapter } from '../adapters/adapters.js';
import { installAll } from '../installation/install.js';
import { restoreAll, statusAll, uninstallAll } from '../installation/lifecycle.js';
import { readInstallRecord } from '../installation/records.js';
import { HarnessmithError } from '../shared/types.js';

/**
 * Hub ownership semantics shared by every host: one rendered Harness under
 * `~/.agents/harnessmith`, hosts only hold symlinks, and the hub lives exactly as long as
 * at least one host owns it.
 */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-hub-lifecycle-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const env = {
    ...process.env,
    HOME: root,
    CODEX_HOME: join(root, 'codex'),
    CLAUDE_CONFIG_DIR: join(root, 'claude'),
    KIMI_CODE_HOME: join(root, 'kimi'),
    HARNESS_REPOSITORY_ROOT: join(root, 'repositories'),
    HARNESS_OWNER: 'hub-lifecycle',
  };
  for (const key of ['HARNESS_HOME', 'HARNESS_MEMORY_HOME', 'HARNESS_PERSONAL_HOME']) {
    delete (env as NodeJS.ProcessEnv)[key];
  }
  const codex = createAdapter('codex', { env });
  const claude = createAdapter('claude', { env });
  const kimi = createAdapter('kimi', { env });
  return { root, env, codex, claude, kimi, hub: codex.hub };
}

test('hosts installed together share one hub layer and the hub records every owner', () => {
  const { env, codex, claude, hub } = fixture();

  const results = installAll([codex, claude], { env, noInitGlobal: true });

  const hubRecord = readInstallRecord(hub);
  assert.ok(hubRecord);
  assert.deepEqual(hubRecord.owners, ['codex', 'claude']);
  assert.deepEqual(hubRecord.installed, ['codex', 'claude']);
  assert.equal(readInstallRecord(codex)?.stamp, hubRecord.stamp);
  assert.equal(readInstallRecord(claude)?.stamp, hubRecord.stamp);
  assert.equal(readInstallRecord(claude)?.hub, hub.home);
  assert.equal(results.length, 2);
  for (const adapter of [codex, claude]) {
    const status = statusAll([adapter])[0];
    assert.equal(status.installed, true);
    assert.equal(status.hub.installed, true);
    assert.deepEqual(status.hub.owners, ['codex', 'claude']);
    assert.equal(
      status.outputs.every(({ status: state }) => state === 'managed'),
      true,
    );
  }
  assert.equal(lstatSync(join(codex.home, 'AGENTS.md')).isSymbolicLink(), true);
  assert.equal(
    readFileSync(join(codex.home, 'AGENTS.md'), 'utf8'),
    readFileSync(hub.entry, 'utf8'),
  );
  assert.equal(rulesRendered(hub.entry), true);
});

function rulesRendered(entry: string): boolean {
  return /managed-by: harnessmith/.test(readFileSync(entry, 'utf8'));
}

test('a later install adds an owner and a hub layer that restore unwinds together with the host', () => {
  const { env, codex, claude, kimi, hub } = fixture();
  installAll([codex, claude], { env, noInitGlobal: true });
  const firstStamp = readInstallRecord(hub)?.stamp;

  installAll([kimi], { env, noInitGlobal: true });
  const second = readInstallRecord(hub);
  assert.ok(second);
  assert.deepEqual(second.owners, ['codex', 'claude', 'kimi']);
  assert.deepEqual(second.installed, ['kimi']);
  assert.notEqual(second.stamp, firstStamp);
  assert.ok(second.recordBackup, 'the previous hub layer is kept as a backup');

  const restored = restoreAll([kimi]);
  assert.equal(restored[0].hub, 'unwind');
  assert.equal(existsSync(kimi.record), false);
  assert.equal(existsSync(join(kimi.home, 'AGENTS.md')), false);
  const unwound = readInstallRecord(hub);
  assert.ok(unwound);
  assert.equal(unwound.stamp, firstStamp);
  assert.deepEqual(unwound.owners, ['codex', 'claude']);
  assert.equal(statusAll([codex])[0].installed, true);
});

test('a departed co-installed host no longer blocks restoring the host that stayed', () => {
  const { env, codex, claude, hub } = fixture();
  installAll([codex, claude], { env, noInitGlobal: true });
  uninstallAll([claude]);
  assert.deepEqual(readInstallRecord(hub)?.owners, ['codex']);
  assert.deepEqual(readInstallRecord(hub)?.installed, ['codex', 'claude']);

  const restored = restoreAll([codex]);

  assert.equal(restored[0].hub, 'unwind');
  assert.equal(existsSync(codex.record), false);
  assert.equal(readInstallRecord(hub), null);
});

test('restore refuses to split a hub layer shared by hosts installed in one transaction', () => {
  const { env, codex, claude, hub } = fixture();
  installAll([codex, claude], { env, noInitGlobal: true });
  const before = readFileSync(hub.record, 'utf8');

  assert.throws(
    () => restoreAll([codex]),
    (error: unknown) =>
      error instanceof HarnessmithError &&
      error.code === 'STATE_CONFLICT' &&
      /--agent codex --agent claude/.test(error.message),
  );
  assert.equal(readFileSync(hub.record, 'utf8'), before);
  assert.equal(existsSync(codex.record), true);

  const restored = restoreAll([codex, claude]);
  assert.deepEqual(
    restored.map(({ hub: action }) => action),
    ['unwind', 'unwind'],
  );
  assert.equal(existsSync(hub.record), false);
  assert.equal(existsSync(hub.harness), false);
  assert.equal(existsSync(hub.discoveryLink), false);
});

test('uninstalling one host releases its ownership; the last owner unwinds the hub', () => {
  const { env, codex, claude, hub } = fixture();
  installAll([codex, claude], { env, noInitGlobal: true });

  const released = uninstallAll([codex]);
  assert.equal(released[0].hub, 'release');
  assert.equal(released[0].layers, 1);
  assert.equal(existsSync(codex.record), false);
  assert.equal(existsSync(join(codex.home, 'AGENTS.md')), false);
  assert.deepEqual(readInstallRecord(hub)?.owners, ['claude']);
  assert.ok(existsSync(join(hub.harness, 'SKILL.md')));
  assert.equal(statusAll([claude])[0].installed, true);
  assert.equal(
    statusAll([claude])[0].outputs.every(({ status }) => status === 'managed'),
    true,
  );

  const unwound = uninstallAll([claude]);
  assert.equal(unwound[0].hub, 'unwind');
  assert.equal(unwound[0].hubLayers, 1);
  assert.equal(existsSync(hub.record), false);
  assert.equal(existsSync(hub.harness), false);
  assert.equal(existsSync(hub.entry), false);
  assert.equal(existsSync(hub.discoveryLink), false);
  assert.equal(existsSync(join(hub.agentsHome, 'skills')), false);
  assert.ok(existsSync(hub.rules), 'personal rules are user data and survive uninstall');
});

test('project-scoped hosts own the hub once per project, so one project leaving keeps the rest linked', () => {
  const { root, env, hub } = fixture();
  const projects = ['alpha', 'beta'].map((name) => {
    const project = join(root, 'projects', name);
    mkdirSync(project, { recursive: true });
    return createAdapter('cursor', { env, project });
  });
  const [alpha, beta] = projects;
  assert.ok(alpha && beta);

  installAll([alpha], { env, noInitGlobal: true });
  installAll([beta], { env, noInitGlobal: true });
  const owners = readInstallRecord(hub)?.owners ?? [];
  assert.equal(owners.length, 2);
  assert.ok(owners.every((owner) => owner.startsWith('cursor:')));
  assert.ok(owners.some((owner) => owner.endsWith(alpha.project ?? '\u0000')));

  const released = uninstallAll([alpha]);
  assert.equal(released[0].hub, 'release');
  assert.ok(existsSync(hub.harness), 'the other project still links into the hub');
  assert.equal(lstatSync(join(beta.home, 'AGENTS.md')).isSymbolicLink(), true);
  assert.equal(readFileSync(join(beta.home, 'AGENTS.md'), 'utf8').length > 0, true);
  assert.deepEqual(
    (readInstallRecord(hub)?.owners ?? []).map((owner) => owner.split(':', 1)[0]),
    ['cursor'],
  );

  const unwound = uninstallAll([beta]);
  assert.equal(unwound[0].hub, 'unwind');
  assert.equal(existsSync(hub.harness), false);
});

test('a host that was never installed cannot restore or uninstall the shared hub', () => {
  const { env, codex, kimi, hub } = fixture();
  installAll([codex], { env, noInitGlobal: true });

  assert.throws(() => restoreAll([kimi]), /No Harnessmith installation found/);
  const noop = uninstallAll([kimi]);
  assert.equal(noop[0].layers, 0);
  assert.equal(noop[0].hub, 'release');
  assert.deepEqual(readInstallRecord(hub)?.owners, ['codex']);
  assert.ok(existsSync(hub.harness));
});
