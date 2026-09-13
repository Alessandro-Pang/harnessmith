import assert from 'node:assert/strict';
import { test } from 'vitest';
import { normalizeEvalGateArgs } from '../../scripts/evaluation/records/eval-gate-args.js';

test('normalizes the separator emitted by pnpm run before Commander parses arguments', () => {
  assert.deepEqual(normalizeEvalGateArgs(['gate', '--', '--json']), ['gate', '--json']);
  assert.deepEqual(
    normalizeEvalGateArgs(['plan', '--changed-file', 'packages/cli/src/cli.ts', '--', '--json']),
    ['plan', '--changed-file', 'packages/cli/src/cli.ts', '--json'],
  );
});

test('does not remove a literal separator that belongs to a repeated option value', () => {
  assert.deepEqual(
    normalizeEvalGateArgs(['compare', '--baseline-runs-dir', '--', '--candidate-runs-dir', 'runs']),
    ['compare', '--baseline-runs-dir', '--', '--candidate-runs-dir', 'runs'],
  );
});
