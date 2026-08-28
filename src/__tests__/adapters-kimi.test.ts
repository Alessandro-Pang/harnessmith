import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { createAdapter } from '../adapters.js';

test('Kimi Code CLI adapter installs its global rule in the effective data directory', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-kimi-config-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const configured = join(root, 'custom-kimi-code');
  const canonicalRoot = realpathSync.native(root);

  const adapter = createAdapter('kimi', {
    env: { HOME: root, KIMI_CODE_HOME: configured },
  });

  assert.equal(adapter.label, 'Kimi Code CLI');
  assert.equal(adapter.home, join(canonicalRoot, 'custom-kimi-code'));
  assert.equal(adapter.instructions.length, 1);
  assert.equal(adapter.instructions[0].path, join(canonicalRoot, 'custom-kimi-code', 'AGENTS.md'));
  assert.equal(adapter.harness, join(canonicalRoot, 'custom-kimi-code', 'agent-harness'));
  assert.equal(
    adapter.record,
    join(canonicalRoot, 'custom-kimi-code', '.harnessmith', 'install.json'),
  );
  assert.equal(adapter.capabilities.scope, 'global');
  assert.equal(adapter.capabilities.instructionFormat, 'markdown');
  assert.equal(adapter.capabilities.nativeRuleActivation, 'host-default');
});

test('Kimi Code CLI adapter defaults to the documented user data directory', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-kimi-home-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const canonicalRoot = realpathSync.native(root);

  const adapter = createAdapter('kimi', { env: { HOME: root } });

  assert.equal(adapter.home, join(canonicalRoot, '.kimi-code'));
  assert.equal(adapter.instructions[0].path, join(canonicalRoot, '.kimi-code', 'AGENTS.md'));
});
