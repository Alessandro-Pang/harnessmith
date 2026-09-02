import assert from 'node:assert/strict';
import { test } from 'vitest';
import { currentFingerprint, run } from './run-fixture.js';

test('planner selects only scenarios mapped to a changed behavior source', () => {
  const result = run([
    'plan',
    '--changed-file',
    'template/agent-harness/src/commands/search/search.ts',
    '--json',
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    version: 1,
    tier: 'L2',
    reason: 'mapped-behavior-change',
    changedFiles: ['template/agent-harness/src/commands/search/search.ts'],
    scenarios: ['progressive-disclosure'],
  });
});

test('planner fails closed to the complete L3 matrix for an unmapped behavior source', () => {
  const result = run([
    'plan',
    '--changed-file',
    'template/agent-harness/src/lib/new-behavior.ts',
    '--json',
  ]);

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.tier, 'L3');
  assert.equal(output.reason, 'unmapped-behavior-source');
  assert.deepEqual(output.scenarios, Object.keys(currentFingerprint().scenarios));
});

test('planner keeps non-behavior changes in deterministic L1', () => {
  const result = run(['plan', '--changed-file', 'README.md', '--json']);

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    version: 1,
    tier: 'L1',
    reason: 'deterministic-only',
    changedFiles: ['README.md'],
    scenarios: [],
  });
});

test('planner fails closed to L3 when mapped changes exceed the L2 scenario bound', () => {
  const result = run([
    'plan',
    '--changed-file',
    'src/installation/install.ts',
    'src/cli.ts',
    '--json',
  ]);

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.tier, 'L3');
  assert.equal(output.reason, 'selection-exceeds-l2-limit');
  assert.deepEqual(output.scenarios, Object.keys(currentFingerprint().scenarios));
});

test('planner rejects unsafe changed-file paths', () => {
  for (const path of ['../src/installation/install.ts', 'C:/src/installation/install.ts']) {
    const result = run(['plan', '--changed-file', path, '--json']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unsafe changed file path/);
  }
});
