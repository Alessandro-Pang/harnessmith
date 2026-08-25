import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, onTestFinished, test, vi } from 'vitest';
import { initGlobal } from '../commands/init.js';
import { memoryMigrate } from '../commands/memory-migration.js';
import { capturedIo, harnessRuntime } from './helpers/harness.js';

const validationControl = vi.hoisted(() => ({
  enabled: false,
  calls: 0,
  failAt: 3,
  replaceAt: 0,
  replacement: '',
  replacementPath: '',
}));

vi.mock('../lib/memory-validation.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/memory-validation.js')>();
  return {
    ...original,
    validateMemoryRoot: (...args: Parameters<typeof original.validateMemoryRoot>) => {
      validationControl.calls += 1;
      if (
        validationControl.enabled &&
        validationControl.calls === validationControl.replaceAt &&
        validationControl.replacementPath
      ) {
        writeFileSync(validationControl.replacementPath, validationControl.replacement);
        chmodSync(validationControl.replacementPath, 0o640);
      }
      if (validationControl.enabled && validationControl.calls === validationControl.failAt) {
        args[1].error('simulated post-write validation failure');
        throw new Error('Memory check failed: 1 issue(s)');
      }
      return original.validateMemoryRoot(...args);
    },
  };
});

beforeEach(() => {
  validationControl.enabled = false;
  validationControl.calls = 0;
  validationControl.failAt = 3;
  validationControl.replaceAt = 0;
  validationControl.replacement = '';
  validationControl.replacementPath = '';
});

test('migration post-validation failure restores exact bytes and private mode', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-memory-migration-rollback-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const runtime = harnessRuntime(root);
  initGlobal(runtime, capturedIo());
  const profile = join(runtime.memoryHome, 'profile.md');
  chmodSync(profile, 0o600);
  const before = readFileSync(profile, 'utf8');
  validationControl.calls = 0;
  validationControl.enabled = true;

  assert.throws(
    () =>
      memoryMigrate(
        runtime,
        'global',
        'profile',
        JSON.stringify({ description: 'Must roll back' }),
        { apply: true },
        capturedIo(),
      ),
    /rolled back/i,
  );
  assert.equal(readFileSync(profile, 'utf8'), before);
  assert.equal(statSync(profile).mode & 0o777, 0o600);
});

test('migration rollback preserves a validator-time concurrent replacement', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-memory-migration-concurrent-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const runtime = harnessRuntime(root);
  initGlobal(runtime, capturedIo());
  const profile = join(runtime.memoryHome, 'profile.md');
  const concurrent = 'concurrent editor content\n';
  validationControl.calls = 0;
  validationControl.enabled = true;
  validationControl.replaceAt = 3;
  validationControl.replacement = concurrent;
  validationControl.replacementPath = profile;

  assert.throws(
    () =>
      memoryMigrate(
        runtime,
        'global',
        'profile',
        JSON.stringify({ description: 'Do not overwrite a later writer' }),
        { apply: true },
        capturedIo(),
      ),
    new RegExp(`rollback was incomplete.*recovery path ${profile}`, 'i'),
  );
  assert.equal(readFileSync(profile, 'utf8'), concurrent);
  assert.equal(statSync(profile).mode & 0o777, 0o640);
});

test('migration apply refuses a replacement written during proposal validation', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-memory-migration-prewrite-conflict-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const runtime = harnessRuntime(root);
  initGlobal(runtime, capturedIo());
  const profile = join(runtime.memoryHome, 'profile.md');
  const concurrent = 'concurrent proposal-time content\n';
  validationControl.calls = 0;
  validationControl.enabled = true;
  validationControl.failAt = 0;
  validationControl.replaceAt = 2;
  validationControl.replacement = concurrent;
  validationControl.replacementPath = profile;

  assert.throws(
    () =>
      memoryMigrate(
        runtime,
        'global',
        'profile',
        JSON.stringify({ description: 'Do not overwrite proposal-time edits' }),
        { apply: true },
        capturedIo(),
      ),
    /source changed after proposal validation.*concurrent content retained/i,
  );
  assert.equal(readFileSync(profile, 'utf8'), concurrent);
  assert.equal(statSync(profile).mode & 0o777, 0o640);
});
