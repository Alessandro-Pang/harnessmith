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
import { resolveHub } from '../installation/hub.js';
import { initializeUserData } from '../installation/user-data.js';
import type { Hub } from '../shared/types.js';

function hubFixture(root: string, env: NodeJS.ProcessEnv = {}): Hub {
  const home = join(root, 'hub');
  const script = join(home, 'skills', 'agent-harness', 'scripts', 'harness.mjs');
  mkdirSync(dirname(script), { recursive: true });
  writeFileSync(
    script,
    `import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const personal = process.env.HARNESS_PERSONAL_HOME || join(process.env.HOME, '.agent-harness');
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
  return resolveHub({ HOME: root, HARNESS_HOME: home, ...env });
}

test('initialization pins Harness paths to the hub instead of inheriting parent env', () => {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-user-data-env-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const inheritedPersonalHome = join(root, 'inherited-personal');
  const previous = process.env.HARNESS_PERSONAL_HOME;
  process.env.HARNESS_PERSONAL_HOME = inheritedPersonalHome;
  const hub = hubFixture(root);
  try {
    initializeUserData(
      hub,
      { HOME: join(root, 'other-home'), HARNESS_PERSONAL_HOME: inheritedPersonalHome },
      { global: false },
    );
  } finally {
    if (previous === undefined) delete process.env.HARNESS_PERSONAL_HOME;
    else process.env.HARNESS_PERSONAL_HOME = previous;
  }

  assert.equal(hub.rules, join(root, 'hub', 'rules'));
  assert.equal(existsSync(join(hub.rules, 'README.md')), true);
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
    hubFixture(root, { HARNESS_PERSONAL_HOME: alias }),
    { HOME: root, TEST_ENV_RECORD: record },
    { global: false },
  );

  assert.equal(readFileSync(record, 'utf8'), realpathSync.native(personalHome));
  assert.equal(existsSync(join(personalHome, 'README.md')), true);
});

test('user-data initialization terminates a hung init child instead of waiting out the lock', () => {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-user-data-timeout-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, 'hub');
  const script = join(home, 'skills', 'agent-harness', 'scripts', 'harness.mjs');
  mkdirSync(dirname(script), { recursive: true });
  writeFileSync(script, 'await new Promise(() => {});\n');
  const started = Date.now();

  assert.throws(
    () =>
      initializeUserData(
        resolveHub({ HOME: root, HARNESS_HOME: home }),
        { HOME: root, HARNESS_USER_DATA_INIT_TIMEOUT_MS: '400' },
        { global: false },
      ),
    /timed? ?out|ETIMEDOUT|Timeout/i,
  );
  assert.ok(Date.now() - started < 8_000);
});
