import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { createAdapter } from '../adapters.js';
import { normalizePiAgentDir } from '../pi-paths.js';

test('Pi adapter installs its global rule under PI_CODING_AGENT_DIR when set', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-pi-config-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const configured = join(root, 'custom-pi');
  const canonicalRoot = realpathSync.native(root);

  const adapter = createAdapter('pi', {
    env: {
      HOME: root,
      PI_CODING_AGENT_DIR: configured,
    },
  });

  assert.equal(adapter.label, 'Pi Agent');
  assert.equal(adapter.home, join(canonicalRoot, 'custom-pi'));
  assert.equal(adapter.instructions.length, 1);
  assert.equal(adapter.instructions[0].path, join(canonicalRoot, 'custom-pi', 'AGENTS.md'));
  assert.equal(adapter.harness, join(canonicalRoot, 'custom-pi', 'agent-harness'));
  assert.equal(adapter.record, join(canonicalRoot, 'custom-pi', '.harnessmith', 'install.json'));
  assert.equal(adapter.capabilities.scope, 'global');
  assert.equal(adapter.capabilities.instructionFormat, 'markdown');
  assert.equal(adapter.capabilities.nativeRuleActivation, 'host-default');
});

test('Pi adapter expands a literal tilde in PI_CODING_AGENT_DIR', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-pi-tilde-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const canonicalRoot = realpathSync.native(root);

  const adapter = createAdapter('pi', {
    env: { HOME: root, PI_CODING_AGENT_DIR: '~/.custom-pi' },
  });

  assert.equal(adapter.home, join(canonicalRoot, '.custom-pi'));
  assert.equal(adapter.instructions[0].path, join(canonicalRoot, '.custom-pi', 'AGENTS.md'));
});

test('Pi path normalization accepts Windows shell paths', () => {
  assert.equal(
    normalizePiAgentDir('/mnt/c/Users/pi/.pi/agent', 'C:\\Users\\pi', 'win32'),
    'C:\\Users\\pi\\.pi\\agent',
  );
  assert.equal(
    normalizePiAgentDir('/cygdrive/d/work/pi', 'C:\\Users\\pi', 'win32'),
    'D:\\work\\pi',
  );
  assert.equal(
    normalizePiAgentDir('~/custom-pi', 'C:\\Users\\pi', 'win32'),
    'C:\\Users\\pi\\custom-pi',
  );
});

test('Pi adapter treats empty PI_CODING_AGENT_DIR as unset', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-pi-empty-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const canonicalRoot = realpathSync.native(root);

  const adapter = createAdapter('pi', {
    env: { HOME: root, PI_CODING_AGENT_DIR: '   ' },
  });

  assert.equal(adapter.home, join(canonicalRoot, '.pi', 'agent'));
  assert.equal(adapter.instructions[0].path, join(canonicalRoot, '.pi', 'agent', 'AGENTS.md'));
});

test('Pi adapter defaults to the documented nested home', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-pi-home-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const canonicalRoot = realpathSync.native(root);

  const adapter = createAdapter('pi', { env: { HOME: root } });

  assert.equal(adapter.home, join(canonicalRoot, '.pi', 'agent'));
});
