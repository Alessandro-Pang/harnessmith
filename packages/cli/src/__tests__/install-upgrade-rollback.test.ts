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
import { join } from 'node:path';
import { onTestFinished, test, vi } from 'vitest';

const cleanupFailure = vi.hoisted(() => ({ calls: 0, failOnCall: 0 }));

vi.mock('../shared/files.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../shared/files.js')>();
  return {
    ...actual,
    removeExact(path: string) {
      if (path.includes('.harnessmith-stage-')) {
        cleanupFailure.calls += 1;
        if (cleanupFailure.calls === cleanupFailure.failOnCall) {
          throw new Error('injected stage cleanup failure');
        }
      }
      actual.removeExact(path);
    },
  };
});

import { elementAt } from '../../../../packages/harness/src/__tests__/helpers/harness.js';
import { hostAdapter } from '../adapters/host-adapter.js';
import { installAll } from '../installation/install.js';
import { resolveUserData } from '../installation/user-data-paths.js';
import type { Adapter, InstallRecord, UserDataPaths } from '../shared/types.js';

function fixture(prefix: string): {
  root: string;
  home: string;
  userData: UserDataPaths;
  env: NodeJS.ProcessEnv;
} {
  const root = mkdtempSync(join(tmpdir(), prefix));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const env = { ...process.env, HOME: root };
  for (const key of ['HARNESS_HOME', 'HARNESS_MEMORY_HOME', 'HARNESS_PERSONAL_HOME']) {
    delete (env as NodeJS.ProcessEnv)[key];
  }
  const home = join(root, 'host');
  mkdirSync(home, { recursive: true });
  return { root, home, userData: resolveUserData(env), env };
}

function stageNames(home: string): string[] {
  if (!existsSync(home)) return [];
  return readdirSync(home).filter((name) => name.startsWith('.harnessmith-stage-'));
}

function primaryInstruction(adapter: Adapter): string {
  const path = elementAt(adapter.instructions, 0)?.path;
  assert.ok(path);
  return path;
}

/** User data is not a managed scope: it never carries an install record. */
function userDataRecordPath(userData: UserDataPaths): string {
  return join(userData.home, '.harnessmith', 'install.json');
}

/** Simulate user drift on every managed instruction file before an upgrade. */
function modifyManagedInstructions(adapters: Adapter[]): void {
  for (const adapter of adapters) {
    writeFileSync(primaryInstruction(adapter), `user-modified ${adapter.name} rules`);
  }
}

function assertPreviousInstallation(adapters: Adapter[], records: Map<string, string>): void {
  for (const adapter of adapters) {
    assert.equal(
      readFileSync(primaryInstruction(adapter), 'utf8'),
      `user-modified ${adapter.name} rules`,
    );
    assert.equal(readFileSync(adapter.record, 'utf8'), records.get(adapter.record));
  }
}

test('post-commit user data failure restores the previous rendered files and records', () => {
  const { home, userData, env } = fixture('harnessmith-upgrade-init-rollback-');
  const adapter = hostAdapter('codex', home, userData);
  installAll([adapter], { env, noInitGlobal: true });
  modifyManagedInstructions([adapter]);
  const records = new Map([[adapter.record, readFileSync(adapter.record, 'utf8')]]);

  assert.throws(
    () =>
      installAll([adapter], {
        env,
        force: true,
        noInitGlobal: true,
        afterUserDataInitialize: () => {
          throw new Error('post-commit initialization failed');
        },
      }),
    /post-commit initialization failed/,
  );

  assertPreviousInstallation([adapter], records);
  assert.deepEqual(stageNames(home), []);
  assert.deepEqual(stageNames(userData.home), []);
  assert.equal(existsSync(userDataRecordPath(userData)), false, 'user data carries no record');
});

test('a second Adapter commit failure rolls back the first Adapter in reverse order', () => {
  const { root, home, userData, env } = fixture('harnessmith-upgrade-multi-rollback-');
  const secondHome = join(root, 'second-host');
  mkdirSync(secondHome, { recursive: true });
  const first = hostAdapter('codex', home, userData);
  const initialSecond = hostAdapter('claude', secondHome, userData, {
    instructionFiles: ['CLAUDE.md', join('blocked', 'CLAUDE.md')],
  });
  mkdirSync(join(secondHome, 'blocked'), { recursive: true });
  installAll([first, initialSecond], { env, noInitGlobal: true });
  modifyManagedInstructions([first, initialSecond]);
  const records = new Map(
    [first.record, initialSecond.record].map((path) => [path, readFileSync(path, 'utf8')]),
  );
  rmSync(join(secondHome, 'blocked'), { recursive: true });
  writeFileSync(join(secondHome, 'blocked'), 'not a directory');
  const second = hostAdapter('claude', secondHome, userData, {
    instructionFiles: ['CLAUDE.md', join('blocked', 'CLAUDE.md')],
  });

  assert.throws(
    () => installAll([first, second], { env, force: true, noInitGlobal: true }),
    /EEXIST|ENOTDIR/,
  );

  assertPreviousInstallation([first, initialSecond], records);
  assert.deepEqual(stageNames(home), []);
  assert.deepEqual(stageNames(secondHome), []);
  assert.deepEqual(stageNames(userData.home), []);
  assert.equal(existsSync(userDataRecordPath(userData)), false);
});

test('upgrade retains rollback material through initialization and cleans every stage on success', () => {
  const { home, userData, env } = fixture('harnessmith-upgrade-stage-cleanup-');
  const adapter = hostAdapter('codex', home, userData);
  installAll([adapter], { env, noInitGlobal: true });
  let stagesDuringInitialization: string[] = [];

  installAll([adapter], {
    env,
    noInitGlobal: true,
    afterUserDataInitialize: () => {
      stagesDuringInitialization = [...stageNames(userData.home), ...stageNames(home)];
    },
  });

  assert.equal(stagesDuringInitialization.length, 1, 'only the host stage exists');
  assert.deepEqual(stageNames(userData.home), []);
  assert.deepEqual(stageNames(home), []);
});

test('post-commit stage cleanup failure keeps the new installation and retained recovery paths', () => {
  const { root, home, userData, env } = fixture('harnessmith-upgrade-cleanup-failure-');
  const secondHome = join(root, 'second-host');
  mkdirSync(secondHome, { recursive: true });
  const first = hostAdapter('codex', home, userData);
  const second = hostAdapter('claude', secondHome, userData, { instructionFiles: ['CLAUDE.md'] });
  writeFileSync(primaryInstruction(first), 'old-codex');
  writeFileSync(primaryInstruction(second), 'old-claude');
  installAll([first, second], { env, force: true, noInitGlobal: true });
  cleanupFailure.calls = 0;
  cleanupFailure.failOnCall = 1;
  onTestFinished(() => {
    cleanupFailure.failOnCall = 0;
  });
  let caught: unknown;

  try {
    installAll([first, second], {
      env,
      force: true,
      noInitGlobal: true,
      stamp: 'post-commit-cleanup',
    });
  } catch (error) {
    caught = error;
  }

  assert.ok(caught);
  for (const adapter of [first, second]) {
    const instruction = primaryInstruction(adapter);
    assert.equal(lstatSync(instruction).isSymbolicLink(), false);
    assert.match(readFileSync(instruction, 'utf8'), /managed-by: harnessmith/);
    const record = JSON.parse(readFileSync(adapter.record, 'utf8')) as InstallRecord;
    assert.equal(record.schemaVersion, 3);
    assert.ok(
      record.recordBackup?.endsWith('.backup-post-commit-cleanup'),
      'the upgrade stamp names the previous record backup',
    );
  }
  assert.equal(existsSync(userDataRecordPath(userData)), false);
  assert.match((caught as Error).message, /post-commit cleanup failed/i);
  assert.deepEqual(stageNames(userData.home), []);
  const retained = [stageNames(home), stageNames(secondHome)];
  assert.equal(elementAt(retained, 0).length, 1);
  assert.equal(elementAt(retained, 1).length, 1);
  const failedStage = join(home, elementAt(elementAt(retained, 0), 0));
  const remainingStage = join(secondHome, elementAt(elementAt(retained, 1), 0));
  assert.match((caught as Error).message, new RegExp(failedStage));
  assert.match((caught as Error).message, new RegExp(remainingStage));
  const backup = readdirSync(home).find((name) => name.startsWith('AGENTS.md.backup-'));
  assert.ok(backup, 'the replaced pre-install content stays available for recovery');
  assert.equal(readFileSync(join(home, backup), 'utf8'), 'old-codex');
});
