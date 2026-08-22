import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { onTestFinished, test } from 'vitest';

test('architecture preflight catches module syntax missed by the legacy from regex', async () => {
  const fixtures = {
    'commands/export.ts': "export * from './sibling.js';\n",
    'commands/import.ts': "import { sibling } from './sibling.js';\n",
    'lib/dynamic.ts': "export const command = import('../commands/run.js');\n",
    'lib/export.ts': "export { run } from '../commands/run.js';\n",
    'lib/import-equals.ts': "import run = require('../commands/run.js');\n",
    'lib/side-effect.ts': "import '../commands/run.js';\n",
  };
  const legacyFromPattern = /from\s+['"]([^'"]+)['"]/;
  assert.deepEqual(
    Object.entries(fixtures)
      .filter(([, content]) => !legacyFromPattern.test(content))
      .map(([path]) => path),
    ['lib/dynamic.ts', 'lib/import-equals.ts', 'lib/side-effect.ts'],
  );
  const checker = join(import.meta.dirname, '..', '..', 'scripts', 'preflight-architecture.ts');
  assert.equal(existsSync(checker), true, 'preflight architecture checker must exist');
  const { checkArchitectureImports } = await import('../../scripts/preflight-architecture.js');
  const sourceRoot = mkdtempSync(join(tmpdir(), 'harness-preflight-architecture-'));
  onTestFinished(() => rmSync(sourceRoot, { recursive: true, force: true }));
  for (const [path, content] of Object.entries(fixtures)) {
    const target = join(sourceRoot, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  const failures: string[] = [];

  checkArchitectureImports(sourceRoot, (condition, message) => {
    if (!condition) failures.push(message);
  });

  assert.equal(failures.length, Object.keys(fixtures).length);
  for (const path of Object.keys(fixtures))
    assert.ok(
      failures.some((message) => message.includes(path)),
      `missing violation for ${path}`,
    );
});
