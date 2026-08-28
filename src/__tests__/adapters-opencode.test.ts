import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { createAdapter } from '../adapters.js';

test('OpenCode adapter installs its global rule in the effective config directory', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-opencode-config-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const configured = join(root, 'custom-opencode');
  const canonicalRoot = realpathSync.native(root);

  const adapter = createAdapter('opencode', {
    env: {
      HOME: root,
      OPENCODE_CONFIG_DIR: configured,
      XDG_CONFIG_HOME: join(root, 'xdg'),
    },
  });

  assert.equal(adapter.label, 'OpenCode');
  assert.equal(adapter.home, join(canonicalRoot, 'custom-opencode'));
  assert.equal(adapter.instructions.length, 1);
  assert.equal(adapter.instructions[0].path, join(canonicalRoot, 'custom-opencode', 'AGENTS.md'));
  assert.equal(adapter.harness, join(canonicalRoot, 'custom-opencode', 'agent-harness'));
  assert.equal(
    adapter.record,
    join(canonicalRoot, 'custom-opencode', '.harnessmith', 'install.json'),
  );
  assert.equal(adapter.capabilities.scope, 'global');
  assert.equal(adapter.capabilities.instructionFormat, 'markdown');
  assert.equal(adapter.capabilities.nativeRuleActivation, 'host-default');
});

test('OpenCode adapter follows XDG_CONFIG_HOME when no custom config directory is set', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-opencode-xdg-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const xdg = join(root, 'xdg');
  const canonicalRoot = realpathSync.native(root);

  const adapter = createAdapter('opencode', {
    env: { HOME: root, XDG_CONFIG_HOME: xdg },
  });

  assert.equal(adapter.home, join(canonicalRoot, 'xdg', 'opencode'));
  assert.equal(adapter.instructions[0].path, join(canonicalRoot, 'xdg', 'opencode', 'AGENTS.md'));
});

test('OpenCode adapter defaults to the documented user config directory', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-opencode-home-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const canonicalRoot = realpathSync.native(root);

  const adapter = createAdapter('opencode', { env: { HOME: root } });

  assert.equal(adapter.home, join(canonicalRoot, '.config', 'opencode'));
});
