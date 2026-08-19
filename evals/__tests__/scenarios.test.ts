import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { test } from 'vitest';

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

test('behavior evaluation catalog has unique, observable scenarios', () => {
  const catalog = JSON.parse(readFileSync(join(root, 'evals', 'scenarios.json'), 'utf8'));
  assert.equal(catalog.schemaVersion, 1);
  assert.ok(catalog.scenarios.length >= 5);
  const ids = new Set();
  for (const scenario of catalog.scenarios) {
    assert.match(scenario.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(!ids.has(scenario.id), `duplicate scenario: ${scenario.id}`);
    ids.add(scenario.id);
    assert.ok(scenario.prompt.length > 0);
    assert.ok(Array.isArray(scenario.setup) && scenario.setup.length > 0);
    assert.ok(Array.isArray(scenario.pass) && scenario.pass.length > 0);
    assert.ok(Array.isArray(scenario.automatedChecks) && scenario.automatedChecks.length > 0);
    for (const check of scenario.automatedChecks) {
      const [file, title] = check.split('#');
      assert.ok(file && title, `invalid automated check: ${check}`);
      const source = readFileSync(join(root, file), 'utf8');
      assert.ok(source.includes(`test('${title}'`), `missing automated check: ${check}`);
    }
  }
});

test('manual host evaluation evidence has a versioned machine-readable contract', () => {
  const schema = JSON.parse(readFileSync(join(root, 'evals', 'run.schema.json'), 'utf8'));
  const example = JSON.parse(readFileSync(join(root, 'evals', 'run.example.json'), 'utf8'));
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

  assert.equal(schema.$id, 'urn:harnessmith:eval-run:v1');
  assert.equal(validate(example), true, JSON.stringify(validate.errors));
  assert.equal(example.redacted, true);
  assert.match(example.transcriptRef, /^(?:local|artifact):/);
});
