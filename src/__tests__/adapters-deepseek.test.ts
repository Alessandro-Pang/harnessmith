import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { createAdapter } from '../adapters.js';

test('DeepSeek adapter installs its global rule under DSH_HOME when set', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-deepseek-config-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const configured = join(root, 'custom-dsh');
  const canonicalRoot = realpathSync.native(root);

  const adapter = createAdapter('deepseek', {
    env: {
      HOME: root,
      DSH_HOME: configured,
    },
  });

  assert.equal(adapter.label, 'DeepSeek Harness');
  assert.equal(adapter.home, join(canonicalRoot, 'custom-dsh'));
  assert.equal(adapter.instructions.length, 1);
  assert.equal(adapter.instructions[0].path, join(canonicalRoot, 'custom-dsh', 'AGENTS.md'));
  assert.equal(adapter.harness, join(canonicalRoot, 'custom-dsh', 'agent-harness'));
  assert.equal(adapter.record, join(canonicalRoot, 'custom-dsh', '.harnessmith', 'install.json'));
  assert.equal(adapter.capabilities.scope, 'global');
  assert.equal(adapter.capabilities.instructionFormat, 'markdown');
  assert.equal(adapter.capabilities.nativeRuleActivation, 'host-default');
});

test('DeepSeek adapter treats empty DSH_HOME as unset', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-deepseek-empty-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const canonicalRoot = realpathSync.native(root);

  const adapter = createAdapter('deepseek', {
    env: { HOME: root, DSH_HOME: '   ' },
  });

  assert.equal(adapter.home, join(canonicalRoot, '.dsh'));
  assert.equal(adapter.instructions[0].path, join(canonicalRoot, '.dsh', 'AGENTS.md'));
});

test('DeepSeek adapter defaults to the documented harness home', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-deepseek-home-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const canonicalRoot = realpathSync.native(root);

  const adapter = createAdapter('deepseek', { env: { HOME: root } });

  assert.equal(adapter.home, join(canonicalRoot, '.dsh'));
});
