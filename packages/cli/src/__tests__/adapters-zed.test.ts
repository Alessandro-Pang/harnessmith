import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { createAdapter, resolveZedAgentHome } from '../adapters/adapters.js';

test('Zed Agent adapter uses the documented Unix personal configuration directory', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-zed-config-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const canonicalRoot = realpathSync.native(root);

  const adapter = createAdapter('zed', {
    env: { HOME: root, APPDATA: join(root, 'appdata') },
  });
  const expectedHome =
    process.platform === 'win32'
      ? join(canonicalRoot, 'appdata', 'Zed')
      : join(canonicalRoot, '.config', 'zed');

  assert.equal(adapter.label, 'Zed Agent');
  assert.equal(adapter.home, expectedHome);
  assert.equal(adapter.instructions.length, 1);
  assert.equal(adapter.instructions[0].path, join(expectedHome, 'AGENTS.md'));
  assert.equal(adapter.harness, join(expectedHome, 'agent-harness'));
  assert.equal(adapter.record, join(expectedHome, '.harnessmith', 'install.json'));
  assert.equal(adapter.capabilities.scope, 'global');
  assert.equal(adapter.capabilities.instructionFormat, 'markdown');
  assert.equal(adapter.capabilities.nativeRuleActivation, 'host-default');
});

test('Zed Agent adapter uses APPDATA on Windows', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-zed-appdata-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const canonicalRoot = realpathSync.native(root);

  assert.equal(
    resolveZedAgentHome({ APPDATA: join(root, 'AppData'), HOME: join(root, 'home') }, 'win32'),
    join(canonicalRoot, 'AppData', 'Zed'),
  );
});
