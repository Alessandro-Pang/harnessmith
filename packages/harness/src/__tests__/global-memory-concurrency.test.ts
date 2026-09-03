import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, onTestFinished, test, vi } from 'vitest';

const concurrencyFault = vi.hoisted(() => ({
  profilePath: '',
  profileReplacement: '',
  templatePath: '',
}));

vi.mock('../lib/filesystem/templates.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/filesystem/templates.js')>();
  return {
    ...original,
    render: (...args: Parameters<typeof original.render>) => {
      const content = original.render(...args);
      if (concurrencyFault.templatePath) {
        const path = concurrencyFault.templatePath;
        concurrencyFault.templatePath = '';
        writeFileSync(path, content);
        chmodSync(path, 0o640);
      }
      return content;
    },
  };
});

vi.mock('../lib/memory/memory-core.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/memory/memory-core.js')>();
  return {
    ...original,
    upsertCoreReference: (...args: Parameters<typeof original.upsertCoreReference>) => {
      const content = original.upsertCoreReference(...args);
      if (concurrencyFault.profilePath) {
        const path = concurrencyFault.profilePath;
        concurrencyFault.profilePath = '';
        writeFileSync(path, concurrencyFault.profileReplacement);
        chmodSync(path, 0o640);
      }
      return content;
    },
  };
});

import { initializeGlobalMemory } from '../lib/memory/global-memory.js';
import { assertMode, escapeRegExp, harnessRuntime } from './helpers/harness.js';

beforeEach(() => {
  concurrencyFault.profilePath = '';
  concurrencyFault.profileReplacement = '';
  concurrencyFault.templatePath = '';
});

function fixture(prefix: string) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  return harnessRuntime(root);
}

test('global initialization rejects a file created after its missing snapshot', () => {
  const runtime = fixture('harness-global-missing-file-conflict-');
  const readme = join(runtime.memoryHome, 'README.md');
  concurrencyFault.templatePath = readme;

  assert.throws(
    () => initializeGlobalMemory(runtime),
    new RegExp(`rollback was incomplete.*recovery path ${escapeRegExp(readme)}`, 'i'),
  );
  assertMode(readme, 0o640);
});

test('profile-route repair preserves a file replaced after its content snapshot', () => {
  const runtime = fixture('harness-global-profile-route-conflict-');
  initializeGlobalMemory(runtime);
  const core = join(runtime.memoryHome, 'core.md');
  const stale = readFileSync(core, 'utf8').replace('memory:profile', 'memory:stale-profile');
  writeFileSync(core, stale);
  chmodSync(core, 0o600);
  const concurrent = 'concurrent core replacement\n';
  concurrencyFault.profilePath = core;
  concurrencyFault.profileReplacement = concurrent;

  assert.throws(
    () => initializeGlobalMemory(runtime),
    new RegExp(`rollback was incomplete.*recovery path ${escapeRegExp(core)}`, 'i'),
  );
  assert.equal(readFileSync(core, 'utf8'), concurrent);
  assertMode(core, 0o640);
});
