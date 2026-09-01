import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { runCli } from '../cli.js';
import {
  type CaptureEligibilityInput,
  evaluateCaptureEligibility,
} from '../lib/memory-capture-eligibility.js';
import { capturedIo, harnessRuntime } from './helpers/harness.js';

function eligibleInput(overrides: Partial<CaptureEligibilityInput> = {}): CaptureEligibilityInput {
  return {
    evaluation: 'complete',
    candidateKind: 'finding',
    retention: 'durable',
    taskReadOnly: true,
    highValue: true,
    rootInitialized: true,
    typedWriter: 'capture-finding',
    authorized: true,
    source: 'verified',
    containsSecret: false,
    sensitiveData: 'none',
    cheaplyRecoverable: false,
    oneShotAuthorization: false,
    authoritativeDuplicate: false,
    existingMatch: 'none',
    ...overrides,
  };
}

test('negative eligibility rejects unsafe or non-durable candidates before value routing', () => {
  assert.deepEqual(evaluateCaptureEligibility(eligibleInput({ containsSecret: true })), {
    version: 1,
    status: 'blocked',
    eligible: false,
    reasonCode: 'secret-detected',
  });
  assert.equal(
    evaluateCaptureEligibility(eligibleInput({ sensitiveData: 'unredacted' })).reasonCode,
    'unredacted-sensitive-data',
  );
  assert.equal(
    evaluateCaptureEligibility(eligibleInput({ oneShotAuthorization: true })).reasonCode,
    'one-shot-authorization',
  );
  assert.equal(
    evaluateCaptureEligibility(eligibleInput({ cheaplyRecoverable: true })).reasonCode,
    'cheaply-recoverable-current-state',
  );
  assert.equal(
    evaluateCaptureEligibility(eligibleInput({ authoritativeDuplicate: true })).reasonCode,
    'authoritative-fact-duplicate',
  );
});

test('task read-only status does not decide managed sidecar eligibility', () => {
  const readOnly = evaluateCaptureEligibility(eligibleInput({ taskReadOnly: true }));
  const mutable = evaluateCaptureEligibility(eligibleInput({ taskReadOnly: false }));
  assert.deepEqual(readOnly, mutable);
  assert.equal(readOnly.status, 'proposed');
  assert.equal(readOnly.eligible, true);
  assert.equal(readOnly.reasonCode, 'typed-create-ready');
});

test('evaluation distinguishes missing execution, blockers, proposals, and duplicate reconciliation', () => {
  assert.equal(
    evaluateCaptureEligibility(eligibleInput({ evaluation: 'not-run' })).status,
    'not-evaluated',
  );
  assert.equal(
    evaluateCaptureEligibility(eligibleInput({ source: 'missing' })).reasonCode,
    'source-missing',
  );
  assert.equal(
    evaluateCaptureEligibility(eligibleInput({ source: 'inferred' })).reasonCode,
    'source-inferred-only',
  );
  assert.equal(
    evaluateCaptureEligibility(eligibleInput({ authorized: false })).reasonCode,
    'authorization-missing',
  );
  assert.equal(
    evaluateCaptureEligibility(eligibleInput({ rootInitialized: false })).reasonCode,
    'memory-root-uninitialized',
  );
  assert.equal(
    evaluateCaptureEligibility(eligibleInput({ typedWriter: 'none' })).reasonCode,
    'typed-writer-unavailable',
  );
  assert.equal(
    evaluateCaptureEligibility(eligibleInput({ typedWriter: 'capture-input' })).reasonCode,
    'typed-writer-mismatch',
  );
  assert.equal(
    evaluateCaptureEligibility(eligibleInput({ existingMatch: 'same' })).reasonCode,
    'semantic-duplicate',
  );
  assert.equal(
    evaluateCaptureEligibility(eligibleInput({ existingMatch: 'source-update' })).reasonCode,
    'typed-source-update-ready',
  );
});

test('memory evaluate-capture emits stable machine-readable status and reason code', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-capture-eligibility-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const payload = join(root, 'capture.json');
  writeFileSync(payload, JSON.stringify(eligibleInput({ rootInitialized: false })));
  const io = capturedIo();

  assert.equal(
    runCli(['memory', 'evaluate-capture', '--payload-file', payload, '--json'], {
      runtime: harnessRuntime(root),
      io,
    }),
    0,
    io.errors.join('\n'),
  );
  assert.deepEqual(JSON.parse(io.logs[0]), {
    version: 1,
    status: 'proposed',
    eligible: false,
    reasonCode: 'memory-root-uninitialized',
  });
});
