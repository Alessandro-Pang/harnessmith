import assert from 'node:assert/strict';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
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
import { installAll } from '../installation/install.js';
import { commitInstall, rollbackInstall } from '../installation/install-commit.js';
import { prepareInstall } from '../installation/install-stage.js';
import type { Adapter, UserDataPaths } from '../shared/types.js';

function fixture(prefix: string): {
  root: string;
  home: string;
  userData: UserDataPaths;
  env: NodeJS.ProcessEnv;
} {
  const root = mkdtempSync(join(tmpdir(), prefix));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const env = { ...process.env, HOME: root };
  for (const key of [
    'HARNESS_HOME',
    'HARNESS_STATE_HOME',
    'HARNESS_MEMORY_HOME',
    'HARNESS_PERSONAL_HOME',
  ]) {
    delete (env as NodeJS.ProcessEnv)[key];
  }
  const home = join(root, 'host');
  mkdirSync(home, { recursive: true });
  const userDataHome = join(root, '.harnessmith');
  const userData: UserDataPaths = {
    home: userDataHome,
    userHome: root,
    state: join(userDataHome, 'state'),
    rules: join(userDataHome, 'rules'),
    memory: join(userDataHome, 'memory'),
  };
  return { root, home, userData, env };
}

test('rolls back every committed output when a later destination fails', () => {
  const { home, userData, env } = fixture('harnessmith-rollback-');
  writeFileSync(join(home, 'AGENTS.md'), 'old rules');
  writeFileSync(join(home, 'blocked'), 'not a directory');
  const adapter: Adapter = hostAdapter('codex', home, userData, {
    instructionFiles: ['AGENTS.md', join('blocked', 'AGENTS.md')],
  });

  assert.throws(() => installAll([adapter], { env, force: true, noInitGlobal: true }));
  assert.equal(readFileSync(join(home, 'AGENTS.md'), 'utf8'), 'old rules');
  assert.equal(existsSync(adapter.record), false);
  assert.equal(existsSync(join(home, '.harnessmith')), false);
});

test('commit rechecks staged destinations when a parent becomes a symlink', () => {
  const { root, home, userData, env } = fixture('harnessmith-race-');
  const outside = join(root, 'outside');
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(home, 'AGENTS.md'), 'old rules');
  const adapter: Adapter = hostAdapter('codex', home, userData, {
    instructionFiles: ['AGENTS.md', join('rules', 'AGENTS.md')],
  });
  const prepared = prepareInstall(adapter, { env, force: true, noInitGlobal: true });
  symlinkSync(outside, join(home, 'rules'), 'dir');

  assert.throws(() => commitInstall(prepared, 'stamp'), /symlink|symbolic link/i);
  rollbackInstall(prepared);
  assert.equal(readFileSync(join(home, 'AGENTS.md'), 'utf8'), 'old rules');
  assert.equal(existsSync(join(outside, 'AGENTS.md')), false);
  assert.equal(existsSync(adapter.record), false);
});

test('host outputs are independently rendered regular instruction files', () => {
  const { home, userData, env } = fixture('harnessmith-render-');
  const adapter: Adapter = hostAdapter('claude', home, userData, {
    instructionFiles: ['AGENTS.md', 'CLAUDE.md'],
  });

  installAll([adapter], { env, noInitGlobal: true });

  for (const path of [join(home, 'AGENTS.md'), join(home, 'CLAUDE.md')]) {
    assert.equal(lstatSync(path).isSymbolicLink(), false);
    assert.match(readFileSync(path, 'utf8'), /<!-- managed-by: harnessmith -->/);
  }
  assert.equal(existsSync(join(home, 'skills', 'agent-harness')), false);
  assert.ok(existsSync(join(userData.home, 'rules')), 'user data holds personal rules');
  const userDataEntries = new Set(['rules', 'state', 'memory']);
  for (const name of readdirSync(userData.home)) {
    assert.ok(userDataEntries.has(name), `unexpected user-data entry: ${name}`);
  }
});

test('install refuses to run while another process holds the Adapter operation lock', () => {
  const { home, userData, env } = fixture('harnessmith-lock-');
  const adapter: Adapter = hostAdapter('codex', home, userData);
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
  assert.equal(existsSync(adapter.record), false);
});
