import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { createAdapter } from '../adapters.js';

test('WorkBuddy adapter installs CODEBUDDY.md under CODEBUDDY_CONFIG_DIR when set', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-workbuddy-config-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const configured = join(root, 'custom-codebuddy');
  const canonicalRoot = realpathSync.native(root);

  const adapter = createAdapter('workbuddy', {
    env: {
      HOME: root,
      CODEBUDDY_CONFIG_DIR: configured,
    },
  });

  assert.equal(adapter.label, 'WorkBuddy');
  assert.equal(adapter.home, join(canonicalRoot, 'custom-codebuddy'));
  assert.equal(adapter.instructions.length, 1);
  assert.equal(
    adapter.instructions[0].path,
    join(canonicalRoot, 'custom-codebuddy', 'CODEBUDDY.md'),
  );
  assert.equal(adapter.harness, join(canonicalRoot, 'custom-codebuddy', 'agent-harness'));
  assert.equal(
    adapter.record,
    join(canonicalRoot, 'custom-codebuddy', '.harnessmith', 'install.json'),
  );
  assert.equal(adapter.capabilities.scope, 'global');
  assert.equal(adapter.capabilities.instructionFormat, 'markdown');
  assert.equal(adapter.capabilities.nativeRuleActivation, 'host-default');
});

test('WorkBuddy adapter treats empty CODEBUDDY_CONFIG_DIR as unset', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-workbuddy-empty-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const canonicalRoot = realpathSync.native(root);

  const adapter = createAdapter('workbuddy', {
    env: { HOME: root, CODEBUDDY_CONFIG_DIR: '   ' },
  });

  assert.equal(adapter.home, join(canonicalRoot, '.codebuddy'));
  assert.equal(adapter.instructions[0].path, join(canonicalRoot, '.codebuddy', 'CODEBUDDY.md'));
});

test('WorkBuddy adapter defaults to the documented CodeBuddy config home', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-workbuddy-home-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const canonicalRoot = realpathSync.native(root);

  const adapter = createAdapter('workbuddy', { env: { HOME: root } });

  assert.equal(adapter.home, join(canonicalRoot, '.codebuddy'));
});
