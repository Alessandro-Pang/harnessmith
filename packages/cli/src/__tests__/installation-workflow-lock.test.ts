import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, onTestFinished, test, vi } from 'vitest';

const skills = vi.hoisted(() => ({ installSkills: vi.fn(), uninstallSkills: vi.fn() }));
// Only the skills boundary is mocked to inject a controllable barrier; scope locks,
// installAll/uninstallAll, and the contender process all run for real.
vi.mock('../installation/skills.js', () => skills);

import { hostAdapter } from '../adapters/host-adapter.js';
import { installAll } from '../installation/install.js';
import { installWithSkills, uninstallWithSkills } from '../installation/installation-workflow.js';
import { operationLockPath } from '../installation/operation-lock.js';
import { resolveUserData } from '../installation/user-data-paths.js';
import type { Adapter } from '../shared/types.js';

const worker = fileURLToPath(
  new URL('./fixtures/installation-workflow-worker.ts', import.meta.url),
);

interface WorkerResult {
  code: number | null;
  stderr: string;
}

function runWorker(env: NodeJS.ProcessEnv): Promise<WorkerResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--import', 'tsx', worker], {
      env,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('close', (code) => resolve({ code, stderr }));
  });
}

function fixture(): { root: string; home: string; env: NodeJS.ProcessEnv; adapter: Adapter } {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-workflow-lock-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: root,
    HARNESS_MEMORY_HOME: join(root, 'memory'),
    HARNESS_PERSONAL_HOME: join(root, 'personal'),
    HARNESS_REPOSITORY_ROOT: root,
    HARNESS_OWNER: 'workflow-lock-test',
  };
  delete env.HARNESS_HOME;
  delete env.HARNESS_STATE_HOME;
  const home = join(root, 'host');
  mkdirSync(home, { recursive: true });
  const adapter = hostAdapter('codex', home, resolveUserData(env));
  return { root, home, env, adapter };
}

/** Block the synchronous skills step until the contender process reports its result. */
function skillsBarrier(entered: string, release: string): () => void {
  return () => {
    writeFileSync(entered, 'entered');
    const signal = new Int32Array(new SharedArrayBuffer(4));
    const deadline = Date.now() + 20_000;
    while (!existsSync(release) && Date.now() < deadline) {
      Atomics.wait(signal, 0, 0, 25);
    }
    if (!existsSync(release)) throw new Error('skills barrier timed out');
  };
}

beforeEach(() => {
  skills.installSkills.mockReset();
  skills.uninstallSkills.mockReset();
});

test('installWithSkills holds the scope lock across the skills phase', {
  timeout: 60_000,
}, async () => {
  const { root, home, env, adapter } = fixture();
  const entered = join(root, 'skills-entered');
  const release = join(root, 'skills-release');
  skills.installSkills.mockImplementationOnce(skillsBarrier(entered, release));

  const contender = runWorker({
    ...env,
    TEST_ADAPTER_HOME: home,
    TEST_COMMAND: 'install',
    TEST_ENTERED: entered,
    TEST_RELEASE: release,
  });
  installWithSkills([adapter], { env, noInitGlobal: true });
  const result = await contender;

  assert.equal(result.code, 4, `contender must be locked out during skills:\n${result.stderr}`);
  assert.match(result.stderr, /^OPERATION_LOCKED:/m);
  assert.equal(existsSync(operationLockPath(adapter)), false, 'the workflow releases the lock');
  installAll([adapter], { env, noInitGlobal: true });
});

test('uninstallWithSkills holds the scope lock across the skill removal phase', {
  timeout: 60_000,
}, async () => {
  const { root, home, env, adapter } = fixture();
  installAll([adapter], { env, noInitGlobal: true });
  const entered = join(root, 'skills-entered');
  const release = join(root, 'skills-release');
  skills.uninstallSkills.mockImplementationOnce(skillsBarrier(entered, release));

  const contender = runWorker({
    ...env,
    TEST_ADAPTER_HOME: home,
    TEST_COMMAND: 'uninstall',
    TEST_ENTERED: entered,
    TEST_RELEASE: release,
  });
  uninstallWithSkills([adapter], {}, env);
  const result = await contender;

  assert.equal(
    result.code,
    4,
    `contender must be locked out during skill removal:\n${result.stderr}`,
  );
  assert.match(result.stderr, /^OPERATION_LOCKED:/m);
  assert.equal(existsSync(operationLockPath(adapter)), false, 'the workflow releases the lock');
});

test('skill failures still release the composite workflow lock', () => {
  const { env, adapter } = fixture();
  skills.installSkills.mockImplementationOnce(() => {
    throw new Error('agent directory is read-only');
  });
  assert.throws(
    () => installWithSkills([adapter], { env, noInitGlobal: true }),
    /skill installation failed/,
  );
  assert.equal(existsSync(operationLockPath(adapter)), false);

  skills.uninstallSkills.mockImplementationOnce(() => {
    throw new Error('skill is modified');
  });
  assert.throws(() => uninstallWithSkills([adapter], {}, env), /skill removal failed/);
  assert.equal(existsSync(operationLockPath(adapter)), false);
  installAll([adapter], { env, noInitGlobal: true });
});
