import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { adapterCapabilities } from '../adapters.js';
import type { PreparedInstall } from '../types.js';
import { initializeUserData } from '../user-data.js';

function preparedInstall(root: string): PreparedInstall {
  const home = join(root, 'host');
  const script = join(home, 'agent-harness', 'bin', 'harness.mjs');
  mkdirSync(dirname(script), { recursive: true });
  writeFileSync(
    script,
    `import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const personal = process.env.HARNESS_PERSONAL_HOME || join(process.env.HOME, '.agent-harness');
for (const name of ['README.md', 'AGENTS.md', join('projects', 'repository-map.md')]) {
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
