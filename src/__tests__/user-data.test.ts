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
import { adapterCapabilities } from '../adapters/adapters.js';
import type { PreparedInstall } from '../shared/types.js';
import { initializeUserData } from '../installation/user-data.js';

function preparedInstall(root: string): PreparedInstall {
  const home = join(root, 'host');
  const script = join(home, 'agent-harness', 'bin', 'harness.mjs');
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
  return {
    adapter: {
      name: 'codex',
      label: 'Codex',
      home,
      harness: join(home, 'agent-harness'),
      record: join(home, '.harnessmith', 'install.json'),
      capabilities: adapterCapabilities('codex'),
      instructions: [],
    },
    stageRoot: join(home, 'stage'),
    outputs: [],
    backups: [],
    installed: [],
    recordBackup: null,
    recordWritten: false,
    ignoreWritten: 0,
    ignoreSnapshots: [],
  };
}

test('explicit initialization env does not inherit omitted parent Harness paths', () => {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-user-data-env-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const expectedHome = join(root, 'explicit-home');
  const inheritedPersonalHome = join(root, 'inherited-personal');
  const previous = process.env.HARNESS_PERSONAL_HOME;
  process.env.HARNESS_PERSONAL_HOME = inheritedPersonalHome;
  try {
    initializeUserData(preparedInstall(root), { HOME: expectedHome }, { global: false });
  } finally {
    if (previous === undefined) delete process.env.HARNESS_PERSONAL_HOME;
    else process.env.HARNESS_PERSONAL_HOME = previous;
  }

  assert.equal(existsSync(join(expectedHome, '.agent-harness', 'README.md')), true);
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
    preparedInstall(root),
    { HOME: root, HARNESS_PERSONAL_HOME: alias, TEST_ENV_RECORD: record },
    { global: false },
  );

  assert.equal(readFileSync(record, 'utf8'), realpathSync.native(personalHome));
  assert.equal(existsSync(join(personalHome, 'README.md')), true);
});
