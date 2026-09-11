import assert from 'node:assert/strict';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import lockfile from 'proper-lockfile';
import { onTestFinished, test } from 'vitest';
import { hostAdapter } from '../adapters/host-adapter.js';
import { resolveHub } from '../installation/hub.js';
import {
  commitInstall,
  installAll,
  prepareHub,
  prepareInstall,
  rollbackInstall,
} from '../installation/install.js';
import type { Adapter, Hub } from '../shared/types.js';

function fixture(prefix: string): { root: string; home: string; hub: Hub; env: NodeJS.ProcessEnv } {
  const root = mkdtempSync(join(tmpdir(), prefix));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const env = { ...process.env, HOME: root };
  const home = join(root, 'host');
  mkdirSync(home, { recursive: true });
  return { root, home, hub: resolveHub(env), env };
}

test('rolls back every committed output when a later destination fails', () => {
  const { home, hub, env } = fixture('harnessmith-rollback-');
  mkdirSync(join(home, 'skills', 'agent-harness'), { recursive: true });
  writeFileSync(join(home, 'skills', 'agent-harness', 'old.txt'), 'old harness');
  writeFileSync(join(home, 'AGENTS.md'), 'old rules');
  writeFileSync(join(home, 'blocked'), 'not a directory');
  const adapter: Adapter = hostAdapter('codex', home, hub, {
    instructionFiles: ['AGENTS.md', join('blocked', 'AGENTS.md')],
    skillLink: true,
  });

  assert.throws(() => installAll([adapter], { env, force: true, noInitGlobal: true }));
  assert.equal(readFileSync(join(home, 'AGENTS.md'), 'utf8'), 'old rules');
  assert.equal(
    readFileSync(join(home, 'skills', 'agent-harness', 'old.txt'), 'utf8'),
    'old harness',
  );
  assert.equal(existsSync(hub.harness), false);
  assert.equal(existsSync(hub.record), false);
  assert.equal(existsSync(hub.discoveryLink), false);
});

test('commit rechecks staged destinations when a parent becomes a symlink', () => {
  const { root, home, hub, env } = fixture('harnessmith-race-');
  const outside = join(root, 'outside');
  mkdirSync(outside, { recursive: true });
  const adapter: Adapter = hostAdapter('codex', home, hub, {
    instructionFiles: [join('rules', 'AGENTS.md')],
  });
  const hubStage = prepareHub(hub, [adapter], { env, noInitGlobal: true });
  const prepared = prepareInstall(adapter, hubStage, { env, noInitGlobal: true });
  symlinkSync(outside, join(home, 'rules'), 'dir');

  commitInstall(hubStage, 'stamp', { owners: ['codex'], installed: ['codex'] });
  assert.throws(
    () => commitInstall(prepared, 'stamp', { adapter: 'codex', hub: hub.home }),
    /symlink|symbolic link/i,
  );
  rollbackInstall(prepared);
  rollbackInstall(hubStage);
  assert.equal(existsSync(join(outside, 'AGENTS.md')), false);
  assert.equal(existsSync(hub.harness), false);
  assert.equal(existsSync(hub.record), false);
});

test('host layers are symlinks into a hub that was committed first', () => {
  const { home, hub, env } = fixture('harnessmith-links-');
  const adapter: Adapter = hostAdapter('claude', home, hub, {
    instructionFiles: ['AGENTS.md', 'CLAUDE.md'],
    skillLink: true,
  });

  installAll([adapter], { env, noInitGlobal: true });

  for (const path of [join(home, 'AGENTS.md'), join(home, 'CLAUDE.md')]) {
    assert.equal(lstatSync(path).isSymbolicLink(), true);
    assert.equal(readFileSync(path, 'utf8'), readFileSync(hub.entry, 'utf8'));
  }
  assert.equal(lstatSync(join(home, 'skills', 'agent-harness')).isSymbolicLink(), true);
  assert.equal(lstatSync(hub.discoveryLink).isSymbolicLink(), true);
  assert.equal(existsSync(join(hub.harness, 'SKILL.md')), true);
  assert.equal(existsSync(join(home, 'skills', 'agent-harness', 'SKILL.md')), true);
});

test('install refuses to run while another process holds the Adapter operation lock', () => {
  const { home, hub, env } = fixture('harnessmith-lock-');
  const adapter: Adapter = hostAdapter('codex', home, hub);
  const release = lockfile.lockSync(home, {
    lockfilePath: join(home, '.harnessmith-operation.lock'),
    realpath: false,
    retries: 0,
  });
  onTestFinished(() => release());

  assert.throws(
    () => installAll([adapter], { env, noInitGlobal: true }),
    /another Harnessmith process|operation lock/i,
  );
  assert.equal(existsSync(hub.harness), false);
  assert.equal(existsSync(adapter.record), false);
});
