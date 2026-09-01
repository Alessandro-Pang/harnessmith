import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { createAdapter } from '../adapters.js';
import {
  firstValueFromSetupVerification,
  firstValueFromStatus,
  firstValuePreview,
} from '../first-value.js';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-first-value-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const env = {
    ...process.env,
    HOME: root,
    CODEX_HOME: join(root, 'codex'),
  };
  return { root, env, adapter: createAdapter('codex', { env }) };
}

test('first value preview names the start, end, owners, recovery checkpoint, and local-only boundary', () => {
  const { adapter } = fixture();
  const journey = firstValuePreview([adapter]);

  assert.equal(journey.version, 1);
  assert.equal(journey.start, 'positioning');
  assert.equal(journey.end, 'host-verified');
  assert.equal(journey.states.installed.status, 'not-checked');
  assert.equal(journey.states.healthy.status, 'not-checked');
  assert.equal(journey.states.hostConfigured.status, 'inconclusive');
  assert.equal(journey.states.hostVerified.status, 'inconclusive');
  assert.equal(journey.recovery.status, 'presented');
  assert.equal(journey.telemetry.uploaded, false);
  assert.ok(Object.values(journey.states).every(({ owner }) => typeof owner === 'string'));
  assert.equal(journey.nextAction.code, 'CONFIRM_INSTALL');
});

test('setup verification distinguishes installed and healthy from Host-owned states', () => {
  const journey = firstValueFromSetupVerification([
    { ownership: 'managed', runtimeHealth: 'passed' },
  ]);

  assert.equal(journey.states.installed.status, 'passed');
  assert.equal(journey.states.healthy.status, 'passed');
  assert.equal(journey.states.hostConfigured.status, 'inconclusive');
  assert.equal(journey.states.hostVerified.status, 'inconclusive');
  assert.equal(journey.nextAction.code, 'RUN_CONTROLLED_HOST_TASK');
  assert.equal(journey.firstValueAchieved, false);
});

test('status reports installation evidence without upgrading it to health or Host proof', () => {
  const managed = firstValueFromStatus('managed', 'codex');
  assert.equal(managed.states.installed.status, 'passed');
  assert.equal(managed.states.healthy.status, 'not-checked');
  assert.equal(managed.nextAction.code, 'RUN_DIAGNOSTICS');
  assert.equal(managed.firstValueAchieved, false);

  const missing = firstValueFromStatus('missing', 'codex');
  assert.equal(missing.states.installed.status, 'failed');
  assert.equal(missing.nextAction.code, 'PREVIEW_SETUP');
});
