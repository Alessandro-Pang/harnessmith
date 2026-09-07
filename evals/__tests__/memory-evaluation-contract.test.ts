import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { test } from 'vitest';

const root = join(import.meta.dirname, '..', '..');
type CatalogScenario = {
  id: string;
  expectedDecision: string;
  evaluationStatus: 'active' | 'inconclusive';
  evaluationReason?: string;
  oracle: { command: string; kind: string };
  forbidden: string[];
  promptVariants: string[];
};

test('memory evaluation catalog has explicit positive and negative state cases', () => {
  const schema = JSON.parse(
    readFileSync(join(root, 'evals', 'memory', 'scenarios.schema.json'), 'utf8'),
  );
  const catalog = JSON.parse(
    readFileSync(join(root, 'evals', 'memory', 'scenarios.v1.json'), 'utf8'),
  ) as { scenarios: CatalogScenario[] };
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  assert.equal(validate(catalog), true, JSON.stringify(validate.errors));
  assert.ok(catalog.scenarios.length >= 10);
  assert.ok(catalog.scenarios.some((scenario) => scenario.expectedDecision === 'write'));
  assert.ok(catalog.scenarios.some((scenario) => scenario.expectedDecision === 'no-write'));
  for (const scenario of catalog.scenarios) {
    assert.ok(scenario.oracle.command, `${scenario.id} needs an independent oracle`);
    assert.ok(scenario.forbidden.length > 0, `${scenario.id} needs a forbidden condition`);
    assert.ok(
      scenario.promptVariants.length >= 2,
      `${scenario.id} needs language/wording variation`,
    );
    if (scenario.evaluationStatus === 'inconclusive')
      assert.ok(scenario.evaluationReason, `${scenario.id} needs an evaluator repair reason`);
  }
});

test('known fixture and oracle gaps are explicitly evaluator-inconclusive', () => {
  const catalog = JSON.parse(
    readFileSync(join(root, 'evals', 'memory', 'scenarios.v1.json'), 'utf8'),
  ) as { scenarios: CatalogScenario[] };
  const scenarios = new Map(catalog.scenarios.map((scenario) => [scenario.id, scenario]));
  for (const id of [
    'writer-failure-recovery',
    'close-input',
    'capture-finding',
    'capture-experience',
    'profile-autopilot',
    'handoff',
    'close-handoff',
    'supersede',
    'archive',
    'maintain',
    'repair',
    'migrate',
    'curate',
    'curation-apply',
  ]) {
    assert.equal(scenarios.get(id)?.evaluationStatus, 'inconclusive', id);
    assert.ok(scenarios.get(id)?.evaluationReason, id);
  }
});

test('memory evaluation scenarios do not encode final prose as the success oracle', () => {
  const catalog = JSON.parse(
    readFileSync(join(root, 'evals', 'memory', 'scenarios.v1.json'), 'utf8'),
  ) as { scenarios: CatalogScenario[] };
  for (const scenario of catalog.scenarios) {
    assert.notEqual(scenario.oracle.kind, 'final-response-regex');
    assert.ok(['filesystem', 'memory-state', 'cross-session'].includes(scenario.oracle.kind));
  }
});

test('memory evaluation records bind decisions to state transitions and independent verifiers', () => {
  const schema = JSON.parse(readFileSync(join(root, 'evals', 'memory', 'run.schema.json'), 'utf8'));
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  const record = {
    schemaVersion: 1,
    recordType: 'memory-evaluation',
    runId: 'run-1',
    scenarioId: 'explicit-profile',
    trial: 1,
    host: { adapter: 'codex', product: 'codex', version: '1', model: 'test', modelVersion: '1' },
    subject: { packageVersion: '0.9.0', packageArtifactSha256: 'a'.repeat(64) },
    startedAt: '2026-09-06T00:00:00.000Z',
    finishedAt: '2026-09-06T00:00:01.000Z',
    expectedDecision: 'write',
    actualDecision: {
      decision: 'write',
      action: 'created',
      writer: 'reconcile-profile',
      reasonCode: 'typed-create-ready',
    },
    transition: 'created',
    initialState: { digest: 'b'.repeat(64), changedPaths: [] },
    finalState: { digest: 'c'.repeat(64), changedPaths: ['profile.md'] },
    verifier: {
      command: 'harness memory check global --json',
      exitCode: 0,
      passed: true,
      artifactRef: 'local:verifier.json',
      sha256: 'd'.repeat(64),
    },
    outcome: 'passed',
    failureCategory: null,
  };
  assert.equal(validate(record), true, JSON.stringify(validate.errors));
  assert.equal(
    validate({ ...record, outcome: 'behavior-failed', failureCategory: 'state-mismatch' }),
    true,
  );
});
