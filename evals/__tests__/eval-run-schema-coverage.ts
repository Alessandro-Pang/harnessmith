import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyEvalAdapterEnum,
  checkEvalRunSchemaAdapterEnum,
  evalAdapterEnumsMatch,
  evalRunSchemaPath,
  generateEvalRunSchemaAdapterEnum,
  readEvalAdapterEnum,
  rewriteEvalAdapterEnumSource,
} from '../../scripts/evaluation/contracts/eval-run-schema.js';
import { evalAdapterEnum } from '../../src/adapters/adapter-registry.js';

const repositoryRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const entry = join(repositoryRoot, 'scripts', 'evaluation', 'contracts', 'eval-run-schema.ts');
const expected = evalAdapterEnum();

function runCli(args: string[]) {
  return spawnSync(process.execPath, ['--import', 'tsx', entry, ...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: process.env,
  });
}

assert.ok(evalRunSchemaPath(repositoryRoot).replace(/\\/g, '/').endsWith('evals/run.schema.json'));
assert.equal(checkEvalRunSchemaAdapterEnum(repositoryRoot).ok, true);
assert.equal(evalAdapterEnumsMatch(expected, expected), true);
assert.equal(evalAdapterEnumsMatch(['codex'], expected), false);
assert.equal(evalAdapterEnumsMatch('bad', expected), false);

const schema = {
  properties: {
    host: {
      properties: {
        adapter: { enum: ['legacy'], keep: true },
        product: { type: 'string' },
      },
    },
  },
};
const applied = applyEvalAdapterEnum(schema, expected);
assert.deepEqual(readEvalAdapterEnum(applied), expected);
assert.equal(
  (applied.properties?.host?.properties?.adapter as { keep?: boolean } | undefined)?.keep,
  true,
);

assert.throws(
  () => applyEvalAdapterEnum({ properties: { host: { properties: {} } } }),
  /missing properties\.host\.properties\.adapter/,
);
assert.throws(
  () =>
    applyEvalAdapterEnum({
      properties: { host: { properties: { adapter: 'bad' as unknown as { enum?: unknown } } } },
    }),
  /missing properties\.host\.properties\.adapter/,
);
assert.throws(
  () => rewriteEvalAdapterEnumSource('{"no":"enum"}'),
  /missing a host\.adapter\.enum array/,
);

const okCheck = runCli(['check', `--root=${repositoryRoot}`]);
assert.equal(okCheck.status, 0, okCheck.stderr);
assert.match(okCheck.stdout, /matches adapter registry/);

const okGenerate = runCli(['generate', `--root=${repositoryRoot}`]);
assert.equal(okGenerate.status, 0, okGenerate.stderr);
assert.match(okGenerate.stdout, /Unchanged/);

const root = mkdtempSync(join(tmpdir(), 'harnessmith-eval-schema-coverage-'));
try {
  assert.equal(checkEvalRunSchemaAdapterEnum(root).ok, false);
  assert.throws(
    () => generateEvalRunSchemaAdapterEnum(root),
    /evals\/run\.schema\.json is missing/,
  );
  const missingGenerate = runCli(['generate', `--root=${root}`]);
  assert.equal(missingGenerate.status, 1);
  assert.match(missingGenerate.stderr, /evals\/run\.schema\.json is missing/);

  mkdirSync(join(root, 'evals'), { recursive: true });
  const path = join(root, 'evals', 'run.schema.json');
  writeFileSync(
    path,
    '{\n  "properties": {\n    "host": {\n      "properties": {\n        "adapter": { "enum": ["only-codex"] },\n        "product": { "type": "string" }\n      }\n    }\n  }\n}\n',
  );
  assert.equal(checkEvalRunSchemaAdapterEnum(root).ok, false);
  const driftedCheck = runCli(['check', `--root=${root}`]);
  assert.equal(driftedCheck.status, 1);
  assert.match(driftedCheck.stderr, /must match adapter registry/);

  const generated = generateEvalRunSchemaAdapterEnum(root);
  assert.equal(generated.changed, true);
  assert.deepEqual(
    JSON.parse(readFileSync(path, 'utf8')).properties.host.properties.adapter.enum,
    expected,
  );
  assert.match(readFileSync(path, 'utf8'), /"product": \{ "type": "string" \}/);

  writeFileSync(
    path,
    '{\n  "properties": {\n    "host": {\n      "properties": {\n        "adapter": { "enum": ["only-codex"] }\n      }\n    }\n  }\n}\n',
  );
  const updated = runCli(['generate', `--root=${root}`]);
  assert.equal(updated.status, 0, updated.stderr);
  assert.match(updated.stdout, /Updated/);
  assert.equal(generateEvalRunSchemaAdapterEnum(root).changed, false);
  assert.equal(checkEvalRunSchemaAdapterEnum(root).ok, true);
} finally {
  rmSync(root, { recursive: true, force: true });
}
