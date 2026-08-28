import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
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
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { onTestFinished, test } from 'vitest';
import {
  capturedIo,
  harnessRuntime,
} from '../../template/agent-harness/src/__tests__/helpers/harness.js';
import { initGlobal } from '../../template/agent-harness/src/commands/init.js';
import { checkpointTask, initTask } from '../../template/agent-harness/src/commands/task.js';
import {
  userDataCoordinationTargets as embeddedTargets,
  withUserDataCoordinationLocks as withEmbeddedUserDataCoordinationLocks,
} from '../../template/agent-harness/src/lib/user-data-lock.js';
import { userDataCoordinationTargets, withUserDataCoordinationLocks } from '../user-data-lock.js';

const worker = fileURLToPath(new URL('./fixtures/user-data-worker.ts', import.meta.url));

interface WorkerResult {
  code: number | null;
  stderr: string;
}

function runWorker(env: NodeJS.ProcessEnv): Promise<WorkerResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--import', 'tsx', worker], {
      env: { ...process.env, ...env },
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

async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!existsSync(path)) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${path}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function writeHarness(home: string): void {
  const harness = join(home, 'agent-harness');
  const script = join(harness, 'bin', 'harness.mjs');
  mkdirSync(dirname(script), { recursive: true });
  writeFileSync(
    script,
    `import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const phase = process.argv.find((value) => value === 'personal' || value === 'global');
if (process.env.TEST_ROLE === 'holder') {
  writeFileSync(process.env.TEST_ENTERED, 'entered');
  const deadline = Date.now() + 5000;
  while (!existsSync(process.env.TEST_RELEASE) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  process.stderr.write('injected initialization failure\\n');
  process.exit(23);
}

const root = phase === 'personal' ? process.env.HARNESS_PERSONAL_HOME : process.env.HARNESS_MEMORY_HOME;
const names = phase === 'personal'
  ? [
      'README.md',
      'AGENTS.md',
      join('projects', 'repository-map.yaml'),
      join('projects', 'repository-map.md'),
    ]
  : ['README.md', 'core.md', 'profile.md'];
for (const name of names) {
  const path = join(root, name);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, phase);
}
`,
  );
}

test('cross-Adapter initialization locks custom user-data roots before taking snapshots', async () => {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-user-data-lock-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const memoryHome = join(root, 'custom-memory');
  const personalHome = join(root, 'custom-personal');
  const entered = join(root, 'holder-entered');
  const release = join(root, 'release-holder');
  const codexHome = join(root, 'codex');
  const claudeHome = join(root, 'claude');
  const holderTmp = join(root, 'tmp-holder');
  const contenderTmp = join(root, 'tmp-contender');
  mkdirSync(holderTmp);
  mkdirSync(contenderTmp);
  writeHarness(codexHome);
  writeHarness(claudeHome);
  const sharedEnv = {
    HOME: root,
    HARNESS_MEMORY_HOME: memoryHome,
    HARNESS_PERSONAL_HOME: personalHome,
    TEST_ENTERED: entered,
    TEST_RELEASE: release,
  };

  const holder = runWorker({
    ...sharedEnv,
    TEST_ADAPTER: 'codex',
    TEST_ADAPTER_HOME: codexHome,
    TEST_ROLE: 'holder',
    TMPDIR: holderTmp,
  });
  await waitForFile(entered);
  const contender = await runWorker({
    ...sharedEnv,
    TEST_ADAPTER: 'claude',
    TEST_ADAPTER_HOME: claudeHome,
    TEST_ROLE: 'contender',
    TMPDIR: contenderTmp,
  });
  writeFileSync(release, 'release');
  const holderResult = await holder;

  assert.equal(contender.code, 4, contender.stderr);
  assert.match(contender.stderr, /^OPERATION_LOCKED:/);
  assert.equal(holderResult.code, 1);
  assert.equal(existsSync(memoryHome), false);
  assert.equal(existsSync(personalHome), false);
});

test('coordination targets do not split when process TMPDIR changes', () => {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-user-data-tmpdir-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const original = process.env.TMPDIR;
  try {
    process.env.TMPDIR = join(root, 'first');
    const outer = userDataCoordinationTargets([join(root, 'memory')])[0];
    process.env.TMPDIR = join(root, 'second');
    const embedded = embeddedTargets([join(root, 'memory')])[0];
    assert.equal(outer.target, embedded.target);
    assert.equal(outer.key, embedded.key);
  } finally {
    if (original === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = original;
  }
});

test('missing-root aliases are case-folded on case-insensitive host platforms', () => {
  if (process.platform !== 'darwin' && process.platform !== 'win32') return;
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-user-data-case-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));

  const upper = userDataCoordinationTargets([join(root, 'FutureRoot')])[0];
  const lower = embeddedTargets([join(root, 'futureroot')])[0];
  assert.equal(upper.key, lower.key);
  assert.equal(upper.target, lower.target);
});

test('Task writes cannot race an outer user-data snapshot for the same memory root', () => {
  const project = mkdtempSync(join(tmpdir(), 'harnessmith-task-coordination-'));
  onTestFinished(() => rmSync(project, { recursive: true, force: true }));
  const runtime = harnessRuntime(project);
  initTask(
    runtime,
    {
      project,
      id: 'coordinated-task',
      objective: 'Serialize project memory writes',
      acceptance: ['No snapshot race'],
    },
    capturedIo(),
  );
  const taskPath = join(project, '.agent-docs', 'working', 'coordinated-task', 'task.json');
  const before = readFileSync(taskPath, 'utf8');

  withUserDataCoordinationLocks([join(project, '.agent-docs')], () => {
    assert.throws(
      () =>
        checkpointTask(
          { project, id: 'coordinated-task', summary: 'must not enter snapshot window' },
          capturedIo(),
        ),
      /being initialized|another process|lock/i,
    );
  });

  assert.equal(readFileSync(taskPath, 'utf8'), before);
});

test('coordination canonicalizes aliases while embedded memory roots still reject symlinks', () => {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-user-data-alias-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const memoryHome = join(root, 'memory');
  const alias = join(root, 'memory-alias');
  mkdirSync(memoryHome);
  symlinkSync(memoryHome, alias, 'dir');

  const outer = userDataCoordinationTargets([memoryHome])[0];
  const embedded = embeddedTargets([alias])[0];
  assert.equal(outer.root, embedded.root);
  assert.equal(outer.key, embedded.key);
  assert.equal(outer.target, embedded.target);

  const runtime = { ...harnessRuntime(root), memoryHome: alias };
  withUserDataCoordinationLocks([memoryHome], () => {
    assert.throws(() => initGlobal(runtime, capturedIo()), /symbolic link/i);
    assert.throws(() => initGlobal(runtime, capturedIo(), [outer.key]), /symbolic link/i);
  });
  assert.equal(existsSync(join(memoryHome, 'core.md')), false);

  withUserDataCoordinationLocks([memoryHome], (keys) => {
    assert.throws(() => initGlobal(runtime, capturedIo(), keys), /symbolic link/i);
  });
  assert.equal(existsSync(join(memoryHome, 'core.md')), false);
});

test('outer user-data locks do not swallow a falsy thrown value', () => {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-user-data-falsy-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  let completed = false;

  try {
    withUserDataCoordinationLocks([join(root, 'memory')], () => {
      throw null;
    });
    completed = true;
  } catch (error) {
    assert.equal(error, null);
  }

  assert.equal(completed, false);
});

test('embedded user-data locks do not swallow a falsy thrown value', () => {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-user-data-embedded-falsy-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  let completed = false;

  try {
    withEmbeddedUserDataCoordinationLocks([join(root, 'memory')], [], () => {
      throw null;
    });
    completed = true;
  } catch (error) {
    assert.equal(error, null);
  }

  assert.equal(completed, false);
});

test('outer handoff tokens let the embedded Harness inherit the same live lock', () => {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-user-data-handoff-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const memoryHome = join(root, 'memory');

  const result = withUserDataCoordinationLocks([memoryHome], (tokens) =>
    withEmbeddedUserDataCoordinationLocks([memoryHome], tokens, () => 'inherited'),
  );

  assert.equal(result, 'inherited');
});

test('outer and embedded coordination release per-root targets after success', () => {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-user-data-clean-success-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const outerRoot = join(root, 'outer-memory');
  const embeddedRoot = join(root, 'embedded-memory');
  const outer = userDataCoordinationTargets([outerRoot])[0];
  const embedded = embeddedTargets([embeddedRoot])[0];

  assert.equal(
    withUserDataCoordinationLocks([outerRoot], () => 'outer'),
    'outer',
  );
  assert.equal(
    withEmbeddedUserDataCoordinationLocks([embeddedRoot], [], () => 'embedded'),
    'embedded',
  );

  assert.equal(existsSync(outer.target), false);
  assert.equal(existsSync(`${outer.target}.lock`), false);
  assert.equal(existsSync(embedded.target), false);
  assert.equal(existsSync(`${embedded.target}.lock`), false);
});

test('coordination releases per-root targets after operation failure', () => {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-user-data-clean-failure-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const outerRoot = join(root, 'outer-memory');
  const embeddedRoot = join(root, 'embedded-memory');
  const outer = userDataCoordinationTargets([outerRoot])[0];
  const embedded = embeddedTargets([embeddedRoot])[0];

  assert.throws(
    () =>
      withUserDataCoordinationLocks([outerRoot], () => {
        throw new Error('outer operation failed');
      }),
    /outer operation failed/,
  );
  assert.throws(
    () =>
      withEmbeddedUserDataCoordinationLocks([embeddedRoot], [], () => {
        throw new Error('embedded operation failed');
      }),
    /embedded operation failed/,
  );

  assert.equal(existsSync(outer.target), false);
  assert.equal(existsSync(`${outer.target}.lock`), false);
  assert.equal(existsSync(embedded.target), false);
  assert.equal(existsSync(`${embedded.target}.lock`), false);
});

test('coordination reports the exact retained target when cleanup is unsafe', () => {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-user-data-clean-error-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const memoryRoot = join(root, 'memory');
  const target = userDataCoordinationTargets([memoryRoot])[0].target;
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, 'unknown-entry'), 'do not delete');

  assert.throws(
    () => withUserDataCoordinationLocks([memoryRoot], () => 'completed'),
    (error: unknown) => {
      assert.match(String(error), /cleanup|release/i);
      assert.match(String(error), new RegExp(target.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      return true;
    },
  );
  assert.equal(readFileSync(join(target, 'unknown-entry'), 'utf8'), 'do not delete');
});

test('repeated unique roots do not accumulate coordination target directories', () => {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-user-data-clean-repeat-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const targets = Array.from(
    { length: 24 },
    (_, index) => userDataCoordinationTargets([join(root, `memory-${index}`)])[0],
  );

  for (const target of targets) {
    withUserDataCoordinationLocks([target.root], () => undefined);
  }

  assert.deepEqual(
    targets.filter(({ target }) => existsSync(target)),
    [],
  );
});
