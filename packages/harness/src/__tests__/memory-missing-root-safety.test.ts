import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { archiveMemory, supersedeMemory } from '../commands/memory/memory-lifecycle.js';
import { memoryMigrate } from '../commands/memory/memory-migration.js';
import { capturedIo, harnessRuntime } from './helpers/harness.js';

test('maintenance mutations never initialize a missing project memory root', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-memory-missing-root-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const runtime = harnessRuntime(root);
  const operations = [
    (project: string) => archiveMemory(runtime, project, 'missing', {}, capturedIo()),
    (project: string) => supersedeMemory(runtime, project, 'missing', 'replacement', capturedIo()),
    (project: string) =>
      memoryMigrate(runtime, project, 'missing', '{}', { apply: true }, capturedIo()),
  ];

  for (const [index, operation] of operations.entries()) {
    const project = join(root, `project-${index}`);
    mkdirSync(project);
    execFileSync('git', ['-C', project, 'init', '-q']);
    const memoryRoot = join(project, '.agent-docs');

    assert.throws(
      () => operation(project),
      /memory root.*does not exist|memory document.*does not exist/i,
    );
    assert.equal(existsSync(memoryRoot), false);
  }
});
