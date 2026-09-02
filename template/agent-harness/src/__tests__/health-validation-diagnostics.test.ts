import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test, vi } from 'vitest';

vi.mock('../lib/memory/memory-validation.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/memory/memory-validation.js')>();
  return {
    ...actual,
    validateMemoryRoot(_root: string, io: { log(message: unknown): void }) {
      io.log('validator supplied diagnostic context');
      throw new Error('injected validation failure');
    },
  };
});

import { createHealthReport } from '../lib/health/health.js';
import { harnessRuntime } from './helpers/harness.js';

test('health preserves validator log diagnostics when a memory check fails', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-health-diagnostic-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const runtime = harnessRuntime(root);
  mkdirSync(runtime.memoryHome, { recursive: true });
  for (const name of ['README.md', 'core.md', 'profile.md']) {
    writeFileSync(join(runtime.memoryHome, name), '# fixture\n');
  }

  const check = createHealthReport(runtime).checks.find(({ id }) => id === 'global-memory');

  assert.equal(check?.status, 'failed');
  assert.equal(check?.message, 'injected validation failure');
  assert.deepEqual(check?.details, ['validator supplied diagnostic context']);
});
