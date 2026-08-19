import assert from 'node:assert/strict';
import {
  existsSync,
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
import { adapterCapabilities } from '../adapters.js';
import { commitInstall, installAll, prepareInstall, rollbackInstall } from '../install.js';
import type { Adapter } from '../types.js';

test('rolls back every committed output when a later destination fails', () => {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-rollback-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, 'host');
  mkdirSync(join(home, 'agent-harness'), { recursive: true });
  writeFileSync(join(home, 'agent-harness', 'old.txt'), 'old harness');
  writeFileSync(join(home, 'AGENTS.md'), 'old rules');
  writeFileSync(join(home, 'blocked'), 'not a directory');
  const adapter: Adapter = {
    name: 'codex',
    label: 'Test Host',
    home,
    harness: join(home, 'agent-harness'),
    record: join(home, '.harnessmith', 'install.json'),
    capabilities: adapterCapabilities('codex'),
    instructions: [
      { path: join(home, 'AGENTS.md'), render: (content: string) => content },
      { path: join(home, 'blocked', 'AGENTS.md'), render: (content: string) => content },
    ],
  };

  assert.throws(() =>
    installAll([adapter], {
      env: { ...process.env, HOME: root },
      force: true,
      noInitGlobal: true,
    }),
  );
  assert.equal(readFileSync(join(home, 'AGENTS.md'), 'utf8'), 'old rules');
  assert.equal(readFileSync(join(home, 'agent-harness', 'old.txt'), 'utf8'), 'old harness');
});

test('commit rechecks staged destinations when a parent becomes a symlink', () => {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-race-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, 'host');
  const outside = join(root, 'outside');
  mkdirSync(home, { recursive: true });
  mkdirSync(outside, { recursive: true });
  const adapter: Adapter = {
    name: 'codex',
    label: 'Test Host',
    home,
    harness: join(home, 'agent-harness'),
    record: join(home, '.harnessmith', 'install.json'),
    capabilities: adapterCapabilities('codex'),
    instructions: [
      { path: join(home, 'rules', 'AGENTS.md'), render: (content: string) => content },
    ],
  };
  const prepared = prepareInstall(adapter, {
    env: { ...process.env, HOME: root },
    noInitGlobal: true,
  });
  symlinkSync(outside, join(home, 'rules'), 'dir');

  assert.throws(() => commitInstall(prepared), /symlink|symbolic link/i);
  rollbackInstall(prepared);
  assert.equal(existsSync(join(outside, 'AGENTS.md')), false);
  assert.equal(existsSync(join(home, 'agent-harness')), false);
});

test('install refuses to run while another process holds the Adapter operation lock', () => {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-lock-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, 'host');
  mkdirSync(home, { recursive: true });
  const adapter: Adapter = {
    name: 'codex',
    label: 'Test Host',
    home,
    harness: join(home, 'agent-harness'),
    record: join(home, '.harnessmith', 'install.json'),
    capabilities: adapterCapabilities('codex'),
    instructions: [{ path: join(home, 'AGENTS.md'), render: (content: string) => content }],
  };
  const release = lockfile.lockSync(home, {
    lockfilePath: join(home, '.harnessmith-operation.lock'),
    realpath: false,
    retries: 0,
  });
  onTestFinished(() => release());

  assert.throws(
    () =>
      installAll([adapter], {
        env: { ...process.env, HOME: root },
        noInitGlobal: true,
      }),
    /another Harnesssmith process|operation lock/i,
  );
  assert.equal(existsSync(adapter.harness), false);
  assert.equal(existsSync(adapter.record), false);
});
