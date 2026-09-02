import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { test } from 'vitest';
import { runFirstValueLoop } from '../../scripts/evaluation/first-value-loop.js';

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const readJson = (path: string) => JSON.parse(readFileSync(join(root, path), 'utf8'));

test('first value scenario is versioned and defines every journey step and exit boundary', () => {
  const scenario = readJson('evals/first-value-loop.v1.json');
  const schema = readJson('evals/first-value-loop.schema.json');
  const ajv = new Ajv2020({ allErrors: true, strict: true });

  assert.equal(ajv.validate(schema, scenario), true, JSON.stringify(ajv.errors));
  assert.equal(scenario.start, 'positioning');
  assert.equal(scenario.end, 'host-verified');
  assert.deepEqual(
    scenario.steps.map(({ id }: { id: string }) => id),
    [
      'positioning',
      'host-selected',
      'previewed',
      'installed',
      'healthy',
      'controlled-task-ready',
      'host-configured',
      'recovery-aware',
      'host-verified',
    ],
  );
  assert.ok(
    scenario.steps.every(
      (step: {
        owner?: unknown;
        successSignals?: unknown[];
        failureSignals?: unknown[];
        exitReasons?: unknown[];
      }) =>
        typeof step.owner === 'string' &&
        step.successSignals?.length &&
        step.failureSignals?.length &&
        step.exitReasons?.length,
    ),
  );
});

test('local usability regression emits a schema-valid no-telemetry acceptance record', () => {
  const record = runFirstValueLoop();
  const schema = readJson('evals/first-value-record.schema.json');
  const ajv = new Ajv2020({ allErrors: true, strict: true });

  assert.equal(ajv.validate(schema, record), true, JSON.stringify(ajv.errors));
  assert.equal(record.result, 'local-baseline-passed');
  assert.equal(record.telemetry.uploaded, false);
  assert.equal(record.telemetry.remoteEvidenceUsed, false);
  assert.equal(record.states.installed, 'passed');
  assert.equal(record.states.healthy, 'passed');
  assert.equal(record.states.hostConfigured, 'inconclusive');
  assert.equal(record.states.hostVerified, 'inconclusive');
  assert.equal(record.firstValueAchieved, false);
  assert.deepEqual(record.excludedActivityClaims, [
    'NPM_DOWNLOADS_ARE_NOT_ACTIVE_USERS',
    'GITHUB_TRAFFIC_IS_NOT_ACTIVE_USERS',
    'LOCAL_TESTS_ARE_NOT_ACTIVE_USERS',
  ]);
  assert.equal('activeUsers' in record, false);
});
