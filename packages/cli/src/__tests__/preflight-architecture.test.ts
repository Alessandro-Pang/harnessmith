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

function architectureFailures(
  check: (sourceRoot: string, check: (condition: unknown, message: string) => void) => void,
  fixtures: Record<string, string>,
  prefix: string,
): string[] {
  const sourceRoot = mkdtempSync(join(tmpdir(), prefix));
  onTestFinished(() => rmSync(sourceRoot, { recursive: true, force: true }));
  for (const [path, content] of Object.entries(fixtures)) {
    const target = join(sourceRoot, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  const failures: string[] = [];
  check(sourceRoot, (condition, message) => {
    if (!condition) failures.push(message);
  });
  return failures;
}

test('architecture preflight requires the acceptance gate wherever the completion path lives', async () => {
  const { checkArchitectureImports } = await import(
    '../../../../scripts/preflight/preflight-architecture.js'
  );

  const failures = architectureFailures(
    checkArchitectureImports,
    {
      // A nested, renamed completion path must still be checked, and `==` with double quotes must
      // not read as a different comparison than the spelling the previous checker pinned.
      'commands/task/task.ts':
        "export function close(status: string) { if (status === 'complete') { assertTaskCanComplete(); } return checkpointTaskAtRoot(status); }\n",
      'commands/task/close.ts':
        'export function close(status: string) { if (status == "complete") return writeTask(status); }\n',
    },
    'harness-task-gate-architecture-',
  );

  assert.deepEqual(failures, [
    'commands/task/close.ts: task completion must call assertTaskCanComplete before persistence',
  ]);
});

test('architecture preflight fails closed when the source root has no sources', async () => {
  const { checkArchitectureImports } = await import(
    '../../../../scripts/preflight/preflight-architecture.js'
  );

  let root = '';
  const failures = architectureFailures(
    (sourceRoot, check) => {
      root = sourceRoot;
      checkArchitectureImports(sourceRoot, check);
    },
    {},
    'harness-empty-architecture-',
  );

  assert.deepEqual(failures, [`${root}: architecture check found no lib or commands sources`]);
});

test('a command may import its own modules but not another command directory', async () => {
  const { checkArchitectureImports } = await import(
    '../../../../scripts/preflight/preflight-architecture.js'
  );

  const failures = architectureFailures(
    checkArchitectureImports,
    {
      'commands/bootstrap/bootstrap.ts':
        "import { route } from './bootstrap-route.js';\nexport const run = route;\n",
      'commands/bootstrap/bootstrap-route.ts': 'export const route = 1;\n',
      'commands/task/task.ts':
        "import { route } from '../bootstrap/bootstrap-route.js';\nexport function close(status: string) { if (status === 'complete') { assertTaskCanComplete(); } return checkpointTaskAtRoot(route); }\n",
    },
    'harness-command-unit-architecture-',
  );

  assert.deepEqual(failures, [
    'commands/task/task.ts: commands must not import sibling commands: ../bootstrap/bootstrap-route.js',
  ]);
});

test('area boundary check freezes the cross-area import graph', async () => {
  const { checkAreaImportEdges } = await import(
    '../../../../scripts/preflight/preflight-architecture.js'
  );

  const failures = architectureFailures(
    (sourceRoot, check) => checkAreaImportEdges(sourceRoot, ['status -> shared'], check),
    {
      'installation/install.ts':
        "import { note } from '../status/status.js';\nexport const a = note;\n",
      'status/status.ts': 'export const note = 1;\n',
    },
    'harness-area-edges-',
  );

  assert.deepEqual(
    failures.map((message) => message.split(': ').slice(1).join(': ')),
    [
      'undeclared cross-area import: installation -> status',
      'declared cross-area import no longer exists: status -> shared',
    ],
  );
});

test('architecture preflight fails when no command calls the completion gate at all', async () => {
  const { checkArchitectureImports } = await import(
    '../../../../scripts/preflight/preflight-architecture.js'
  );

  const failures = architectureFailures(
    checkArchitectureImports,
    {
      'commands/report.ts': 'export function close(status: string) { return writeTask(status); }\n',
    },
    'harness-task-gate-missing-',
  );

  assert.deepEqual(failures, [
    'commands: no command calls the task completion gate assertTaskCanComplete',
  ]);
});
