import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'vitest';
import YAML from 'yaml';
import { evaluateCoverage } from '../../scripts/evaluation/contracts/eval-coverage.js';

type ManifestEntry = {
  kind?: string;
  activationRules?: Array<{ mode?: string }>;
};

type Manifest = { entries: Record<string, ManifestEntry> };
type Coverage = {
  requiredPlaybooks: string[];
  requiredReasoningModes: string[];
  requiredReasoningActivations: string[];
  requiredMemoryOperations: string[];
  requiredProfileScenarios: string[];
  requiredHostEvidence: string[];
};

const root = process.cwd();

function readManifest(): Manifest {
  return YAML.parse(
    readFileSync(join(root, 'template', 'agent-harness', 'docs', 'manifest.yaml'), 'utf8'),
  ) as Manifest;
}

function readCoverage(): Coverage {
  return JSON.parse(readFileSync(join(root, 'evals', 'coverage.v1.json'), 'utf8')) as Coverage;
}

test('coverage contract declares every manifest playbook and reasoning mode', () => {
  const manifest = readManifest();
  const coverage = readCoverage();
  const declaredPlaybooks = new Set(coverage.requiredPlaybooks);
  const declaredModes = new Set(coverage.requiredReasoningModes);
  const playbooks = Object.entries(manifest.entries)
    .filter(([, entry]) => entry.kind === 'playbook')
    .map(([name]) => name);
  const modes = manifest.entries['reasoning-modes']?.activationRules?.flatMap((rule) =>
    rule.mode ? [rule.mode] : [],
  );

  assert.deepEqual(
    playbooks.filter((name) => !declaredPlaybooks.has(name)),
    [],
    'coverage.v1.json must be updated when a playbook is added',
  );
  assert.deepEqual(
    modes?.filter((mode) => !declaredModes.has(mode)),
    [],
    'coverage.v1.json must be updated when a reasoning mode is added',
  );
});

test('coverage contract keeps independent Host evidence requirements non-empty', () => {
  const coverage = readCoverage();
  assert.deepEqual(
    new Set(coverage.requiredReasoningActivations),
    new Set(['explicit', 'inferred']),
    'both explicit and inferred reasoning activation cells are required',
  );
  for (const field of ['requiredMemoryOperations', 'requiredHostEvidence'] as const) {
    assert.ok(coverage[field].length > 0, `${field} must not be empty`);
    assert.equal(new Set(coverage[field]).size, coverage[field].length, `${field} must be unique`);
  }
});

test('coverage contract names profile and habit scenarios explicitly', () => {
  const coverage = readCoverage();
  for (const id of [
    'explicit-profile',
    'explicit-coding-style',
    'explicit-research-interest',
    'one-shot-request',
    'repeated-observation',
    'profile-update',
    'profile-conflicting-source',
    'profile-forget-ambiguous',
    'profile-pause-resume',
    'profile-language-precedence',
    'cross-session-recall',
  ]) {
    assert.ok(coverage.requiredProfileScenarios.includes(id), `${id} must be covered`);
  }
});

test('coverage report cannot call registered scenarios or deterministic routing a real Host pass', () => {
  const report = evaluateCoverage();
  assert.equal(report.result, 'inconclusive');
  assert.equal(report.scenarios.measured, 0);
  assert.ok(report.scenarios.unmeasured.length > 0);
  assert.equal(report.reasoning.measured.length, 0);
  assert.equal(report.reasoning.required.length, 15);
  assert.ok(report.promptInventory.rules.length >= 15);
});
