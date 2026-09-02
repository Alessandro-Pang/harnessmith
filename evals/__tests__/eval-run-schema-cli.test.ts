import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { onTestFinished, test } from 'vitest';
import { evalAdapterEnum } from '../../src/adapters/adapter-registry.js';

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const entry = join(root, 'scripts', 'evaluation', 'contracts', 'eval-run-schema.ts');

function run(args: string[]) {
  return spawnSync(process.execPath, ['--import', 'tsx', entry, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: process.env,
  });
}

function temporaryRoot(): string {
  const path = mkdtempSync(join(tmpdir(), 'harnessmith-eval-schema-cli-'));
  onTestFinished(() => rmSync(path, { force: true, recursive: true }));
  return path;
}

test('eval-run-schema check accepts the repository schema', () => {
  const result = run(['check', `--root=${root}`]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /matches adapter registry/);
});

test('eval-run-schema check fails when the enum drifts', () => {
  const tempRoot = temporaryRoot();
  mkdirSync(join(tempRoot, 'evals'), { recursive: true });
  writeFileSync(
    join(tempRoot, 'evals', 'run.schema.json'),
    `${JSON.stringify({ properties: { host: { properties: { adapter: { enum: ['only-codex'] } } } } }, null, 2)}\n`,
  );

  const result = run(['check', `--root=${tempRoot}`]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must match adapter registry/);
  assert.match(result.stderr, /only-codex/);
});

test('eval-run-schema generate rewrites a drifted schema and then reports unchanged', () => {
  const tempRoot = temporaryRoot();
  mkdirSync(join(tempRoot, 'evals'), { recursive: true });
  const schemaPath = join(tempRoot, 'evals', 'run.schema.json');
  writeFileSync(
    schemaPath,
    '{\n  "properties": {\n    "host": {\n      "properties": {\n        "adapter": { "enum": ["only-codex"] }\n      }\n    }\n  }\n}\n',
  );

  const updated = run(['generate', `--root=${tempRoot}`]);
  assert.equal(updated.status, 0, updated.stderr);
  assert.match(updated.stdout, /Updated/);
  assert.deepEqual(
    JSON.parse(readFileSync(schemaPath, 'utf8')).properties.host.properties.adapter.enum,
    evalAdapterEnum(),
  );

  const unchanged = run(['generate', `--root=${tempRoot}`]);
  assert.equal(unchanged.status, 0, unchanged.stderr);
  assert.match(unchanged.stdout, /Unchanged/);
});

test('eval-run-schema generate fails when the schema file is missing', () => {
  const tempRoot = temporaryRoot();
  const result = run(['generate', `--root=${tempRoot}`]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /evals\/run\.schema\.json is missing/);
});
