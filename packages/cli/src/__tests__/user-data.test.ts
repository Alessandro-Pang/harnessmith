import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { initializeUserData } from '../installation/user-data.js';
import { resolveUserData } from '../installation/user-data-paths.js';
import type { UserDataPaths } from '../shared/types.js';

function runtimeEntryFixture(root: string): string {
  const script = join(root, 'runtime-fixture.mjs');
  mkdirSync(dirname(script), { recursive: true });
  writeFileSync(
    script,
    `import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const personal = process.env.HARNESS_PERSONAL_HOME || join(process.env.HOME, '.harnessmith', 'rules');
if (process.env.TEST_ENV_RECORD) writeFileSync(process.env.TEST_ENV_RECORD, personal);
for (const name of [
  'README.md',
  'AGENTS.md',
  join('projects', 'repository-map.yaml'),
  join('projects', 'repository-map.md'),
]) {
  const path = join(personal, name);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, 'initialized\\n');
}
`,
  );
  return script;
}

function userDataFixture(root: string, env: NodeJS.ProcessEnv = {}): UserDataPaths {
  return resolveUserData({ HOME: root, ...env });
}

test('initialization pins Harness paths to user data instead of inheriting parent env', () => {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-user-data-env-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const inheritedPersonalHome = join(root, 'inherited-personal');
  const previous = process.env.HARNESS_PERSONAL_HOME;
  process.env.HARNESS_PERSONAL_HOME = inheritedPersonalHome;
  const userData = userDataFixture(root);
  try {
    initializeUserData(
      userData,
      { HOME: join(root, 'other-home'), HARNESS_PERSONAL_HOME: inheritedPersonalHome },
      { global: false },
    );
  } finally {
    if (previous === undefined) delete process.env.HARNESS_PERSONAL_HOME;
    else process.env.HARNESS_PERSONAL_HOME = previous;
  }

  assert.equal(userData.home, join(realpathSync.native(root), '.harnessmith'));
  assert.equal(userData.rules, join(userData.home, 'rules'));
  assert.equal(existsSync(join(userData.rules, 'README.md')), true);
  assert.equal(existsSync(join(inheritedPersonalHome, 'README.md')), false);
});

test('user-data initialization locks, snapshots, and writes through one canonical root', () => {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-user-data-canonical-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const personalHome = join(root, 'personal');
  const alias = join(root, 'personal-alias');
  const record = join(root, 'child-root.txt');
  mkdirSync(personalHome);
  symlinkSync(personalHome, alias, process.platform === 'win32' ? 'junction' : 'dir');

  initializeUserData(
    userDataFixture(root, { HARNESS_PERSONAL_HOME: alias }),
    { HOME: root, TEST_ENV_RECORD: record },
    { global: false, runtimeEntry: runtimeEntryFixture(root) },
  );

  assert.equal(readFileSync(record, 'utf8'), realpathSync.native(personalHome));
  assert.equal(existsSync(join(personalHome, 'README.md')), true);
});

test('user-data initialization terminates a hung init child instead of waiting out the lock', () => {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-user-data-timeout-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const script = join(root, 'hung-runtime.mjs');
  writeFileSync(script, 'await new Promise(() => {});\n');
  const userData = userDataFixture(root);
  const started = Date.now();

  assert.throws(
    () =>
      initializeUserData(
        userData,
        { HOME: root, HARNESS_USER_DATA_INIT_TIMEOUT_MS: '400' },
        { global: false, runtimeEntry: script },
      ),
    /timed? ?out|ETIMEDOUT|Timeout/i,
  );
  assert.ok(Date.now() - started < 8_000);
  assert.equal(existsSync(userData.rules), false, 'a timed-out init leaves no partial rules root');
});
