import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { onTestFinished, test } from 'vitest';

test('architecture preflight normalizes Windows paths before applying command rules', async () => {
  const { normalizeArchitecturePath } = await import(
    '../../../../scripts/preflight/preflight-architecture.js'
  );

  assert.equal(normalizeArchitecturePath('commands\\memory-input.ts'), 'commands/memory-input.ts');
  assert.equal(normalizeArchitecturePath('commands/task.ts'), 'commands/task.ts');
});

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
  const checker = join(
    import.meta.dirname,
    '..',
    '..',
    'scripts',
    'preflight',
    'preflight-architecture.ts',
  );
  assert.equal(existsSync(checker), true, 'preflight architecture checker must exist');
  const { checkArchitectureImports } = await import(
    '../../../../scripts/preflight/preflight-architecture.js'
  );
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

test('architecture preflight rejects direct filesystem mutation in typed work-state commands', async () => {
  const { checkArchitectureImports } = await import(
    '../../../../scripts/preflight/preflight-architecture.js'
  );
  const sourceRoot = mkdtempSync(join(tmpdir(), 'harness-work-state-architecture-'));
  onTestFinished(() => rmSync(sourceRoot, { recursive: true, force: true }));
  const fixtures = {
    'commands/memory-input.ts':
      "import { writeFileSync } from 'node:fs';\nexport const write = writeFileSync;\n",
    'commands/memory-profile.ts':
      "import fs from 'node:fs';\nexport const write = fs.writeFileSync;\n",
    'commands/task-checkpoint.ts':
      "import { renameSync } from 'node:fs';\nexport const move = renameSync;\n",
    'commands/task-verification.ts':
      "export async function write() { const fs = await import('node:fs/promises'); return fs.writeFile; }\n",
  };
  for (const [path, content] of Object.entries(fixtures)) {
    const target = join(sourceRoot, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  const failures: string[] = [];

  checkArchitectureImports(sourceRoot, (condition, message) => {
    if (!condition) failures.push(message);
  });

  assert.equal(failures.length, 4);
  assert.ok(failures.every((message) => message.includes('direct filesystem mutation')));
});

test('architecture preflight requires the acceptance gate on the task completion path', async () => {
  const { checkArchitectureImports } = await import(
    '../../../../scripts/preflight/preflight-architecture.js'
  );
  const sourceRoot = mkdtempSync(join(tmpdir(), 'harness-task-gate-architecture-'));
  onTestFinished(() => rmSync(sourceRoot, { recursive: true, force: true }));
  const taskCommand = join(sourceRoot, 'commands', 'task.ts');
  mkdirSync(dirname(taskCommand), { recursive: true });
  writeFileSync(
    taskCommand,
    "export function close(status: string) { if (status === 'complete') return writeTask(status); }\n",
  );
  const failures: string[] = [];

  checkArchitectureImports(sourceRoot, (condition, message) => {
    if (!condition) failures.push(message);
  });

  assert.deepEqual(failures, [
    'commands/task.ts: task completion must call assertTaskCanComplete before persistence',
  ]);
});
