import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import {
  applyEvalAdapterEnum,
  checkEvalRunSchemaAdapterEnum,
  type EvalRunSchema,
  generateEvalRunSchemaAdapterEnum,
  readEvalAdapterEnum,
  rewriteEvalAdapterEnumSource,
} from '../../scripts/eval-run-schema.js';
import { evalAdapterEnum } from '../adapter-registry.js';

test('applyEvalAdapterEnum rewrites only host.adapter.enum', () => {
  const schema = {
    $id: 'urn:test',
    properties: {
      host: {
        properties: {
          adapter: { enum: ['legacy'], extra: true },
          product: { type: 'string' },
        },
      },
      other: { keep: true },
    },
  } as EvalRunSchema & {
    $id: string;
    properties: {
      host: {
        properties: { adapter: { enum: string[]; extra: boolean }; product: { type: string } };
      };
      other: { keep: boolean };
    };
  };

  const next = applyEvalAdapterEnum(schema, evalAdapterEnum()) as typeof schema;
  assert.deepEqual(readEvalAdapterEnum(next), evalAdapterEnum());
  assert.equal(next.$id, 'urn:test');
  assert.equal(next.properties.other.keep, true);
  assert.equal(next.properties.host.properties.product.type, 'string');
  assert.equal(next.properties.host.properties.adapter.extra, true);
  assert.deepEqual(schema.properties.host.properties.adapter.enum, ['legacy']);
});

test('generate and check rewrite a drifted eval run schema from the registry', () => {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-eval-schema-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'evals'), { recursive: true });
  const path = join(root, 'evals', 'run.schema.json');
  writeFileSync(
    path,
    `${JSON.stringify(
      {
        properties: {
          host: {
            properties: {
              adapter: { enum: ['only-codex'] },
            },
          },
        },
      },
      null,
      2,
    )}\n`,
  );

  const drifted = checkEvalRunSchemaAdapterEnum(root);
  assert.equal(drifted.ok, false);
  assert.deepEqual(drifted.expected, evalAdapterEnum());

  const generated = generateEvalRunSchemaAdapterEnum(root);
  assert.equal(generated.changed, true);
  assert.deepEqual(
    JSON.parse(readFileSync(path, 'utf8')).properties.host.properties.adapter.enum,
    evalAdapterEnum(),
  );
  assert.equal(checkEvalRunSchemaAdapterEnum(root).ok, true);

  const second = generateEvalRunSchemaAdapterEnum(root);
  assert.equal(second.changed, false);
});

test('rewriteEvalAdapterEnumSource preserves surrounding compact JSON text', () => {
  const source =
    '{\n  "host": {\n    "properties": {\n      "adapter": { "enum": ["only-codex"] },\n      "product": { "type": "string" }\n    }\n  }\n}\n';
  const rewritten = rewriteEvalAdapterEnumSource(source, evalAdapterEnum());
  assert.equal(
    rewritten.includes(`"adapter": { "enum": ${JSON.stringify([...evalAdapterEnum()])} }`),
    true,
  );
  assert.equal(rewritten.includes('"product": { "type": "string" }'), true);
  assert.equal(rewritten.includes('"only-codex"'), false);
});
