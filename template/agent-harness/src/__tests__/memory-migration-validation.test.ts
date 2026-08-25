import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test, vi } from 'vitest';
import { initGlobal } from '../commands/init.js';
import { memoryMigrate } from '../commands/memory-migration.js';
import { capturedIo, harnessRuntime } from './helpers/harness.js';

const validationControl = vi.hoisted(() => ({ fail: false }));

vi.mock('../lib/memory-validation.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/memory-validation.js')>();
  return {
    ...original,
    validateMemoryRoot: (...args: Parameters<typeof original.validateMemoryRoot>) => {
      if (validationControl.fail) throw new Error('simulated validator execution failure');
      return original.validateMemoryRoot(...args);
    },
  };
});

test('memory migration fails closed when root validation cannot execute', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-memory-migration-validation-'));
  onTestFinished(() => rmSync(root, { force: true, recursive: true }));
  const runtime = harnessRuntime(root);
  initGlobal(runtime, capturedIo());
  validationControl.fail = true;

  const report = memoryMigrate(runtime, 'global', 'core', '{}', {}, capturedIo());

  assert.equal(report.ready, false);
  assert.equal(
    report.issues.some((issue) => /validation could not complete.*simulated/i.test(issue)),
    true,
  );
});
