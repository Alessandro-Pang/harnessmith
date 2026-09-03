import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { onTestFinished, test } from 'vitest';
import { createAdapter } from '../adapters/adapters.js';
import { executeCommand } from '../application/command-executor.js';
import { createDiagnosticsReport } from '../diagnostics/diagnostics.js';
import { installAll } from '../installation/install.js';

const packageRoot = dirname(dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url))))));
const schema = JSON.parse(
  readFileSync(join(packageRoot, 'config', 'contracts', 'diagnostics-report.schema.json'), 'utf8'),
);

function fixture(prefix: string) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const env = {
    ...process.env,
    HOME: root,
    CODEX_HOME: join(root, '用户-codex'),
    CLAUDE_CONFIG_DIR: join(root, 'claude-home'),
    HARNESS_MEMORY_HOME: join(root, 'agent-docs'),
    HARNESS_PERSONAL_HOME: join(root, 'personal-harness'),
    HARNESS_REPOSITORY_ROOT: root,
    HARNESS_OWNER: '诊断用户',
  };
  return { root, env };
}

test('diagnostics returns only allowlisted metadata and never leaks paths or raw content', () => {
  const { root, env } = fixture('harnessmith-diagnostics-private-');
  const adapter = createAdapter('codex', { env });
  const secret = ['ghp', '_', 'D'.repeat(24)].join('');
  mkdirSync(dirname(adapter.record), { recursive: true });
  writeFileSync(
    adapter.record,
    JSON.stringify({ prompt: `do not leak ${secret}`, toolArguments: [root], environment: env }),
  );
  mkdirSync(dirname(adapter.instructions[0].path), { recursive: true });
  writeFileSync(adapter.instructions[0].path, `# 私有规则\n${secret}\n`);

  const before = readFileSync(adapter.record, 'utf8');
  const report = createDiagnosticsReport([adapter], { env, project: root });
  const serialized = JSON.stringify(report);

  assert.equal(report.collectionResult, 'partial');
  assert.ok(report.failures.some(({ source }) => source === 'installation'));
  assert.doesNotMatch(serialized, new RegExp(secret));
  assert.doesNotMatch(serialized, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(serialized, /私有规则|诊断用户|prompt|toolArguments|environment/);
  assert.equal(readFileSync(adapter.record, 'utf8'), before);
  assert.equal(report.privacy.uploaded, false);
  assert.equal(report.privacy.persisted, false);
});

test('diagnostics summarizes healthy installed runtime checks without returning their messages', () => {
  const { root, env } = fixture('harnessmith-diagnostics-installed-');
  const adapter = createAdapter('codex', { env });
  installAll([adapter], { env, noInitGlobal: false });

  const report = createDiagnosticsReport([adapter], { env, project: root });
  const item = report.adapters[0];
  assert.equal(report.collectionResult, 'complete');
  assert.equal(item.installation.status, 'managed');
  assert.ok(item.runtimeChecks.some(({ id }) => id === 'installation'));
  assert.ok(item.subsystems.some(({ id }) => id === 'memory'));
  assert.ok(item.subsystems.some(({ id }) => id === 'task'));
  assert.ok(item.subsystems.some(({ id }) => id === 'routing'));
  assert.ok(item.subsystems.some(({ id, status }) => id === 'host' && status === 'inconclusive'));
  assert.doesNotMatch(
    JSON.stringify(report),
    new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
  );
});

test('a failed adapter remains visible when another adapter is collected successfully', () => {
  const { root, env } = fixture('harnessmith-diagnostics-partial-');
  const codex = createAdapter('codex', { env });
  const claude = createAdapter('claude', { env });
  mkdirSync(dirname(codex.record), { recursive: true });
  writeFileSync(codex.record, '{invalid');

  const report = createDiagnosticsReport([codex, claude], { env, project: root });
  assert.equal(report.adapters.length, 2);
  assert.equal(report.collectionResult, 'partial');
  assert.equal(report.failures.length, 1);
  assert.equal(report.failures[0].adapter, 'codex');
  assert.equal(report.adapters[1].adapter, 'claude');
});

test('diagnostics command previews JSON without persisting a report', async () => {
  const { root, env } = fixture('harnessmith-diagnostics-command-');
  const logs: string[] = [];
  const status = await executeCommand(
    'diagnostics',
    { agent: ['codex'], project: root, json: true },
    {
      env,
      io: { log: (value) => logs.push(String(value)) },
      input: new PassThrough(),
      output: new PassThrough(),
    },
  );

  assert.equal(status, 0);
  assert.equal(logs.length, 1);
  assert.equal(JSON.parse(logs[0]).command, 'diagnostics');
  assert.equal(existsSync(join(root, 'diagnostics.json')), false);
});

test('diagnostics schema rejects unknown fields and documents owner, purpose, and retention', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const { root, env } = fixture('harnessmith-diagnostics-schema-');
  const report = createDiagnosticsReport([createAdapter('codex', { env })], { env, project: root });
  assert.equal(ajv.validate(schema, report), true, JSON.stringify(ajv.errors));
  assert.equal(ajv.validate(schema, { ...report, rawPrompt: 'forbidden' }), false);

  function assertMetadata(node: unknown): void {
    if (!node || typeof node !== 'object') return;
    const candidate = node as Record<string, unknown>;
    if (candidate.properties && typeof candidate.properties === 'object') {
      for (const value of Object.values(candidate.properties as Record<string, unknown>)) {
        const field = value as Record<string, unknown>;
        assert.equal(typeof field['x-owner'], 'string');
        assert.equal(typeof field['x-purpose'], 'string');
        assert.equal(typeof field['x-retention'], 'string');
        assertMetadata(field);
      }
    }
    if (candidate.items) assertMetadata(candidate.items);
    if (candidate.$defs && typeof candidate.$defs === 'object') {
      for (const value of Object.values(candidate.$defs as Record<string, unknown>))
        assertMetadata(value);
    }
  }
  assertMetadata(schema);
  assert.equal(existsSync(join(root, 'diagnostics.json')), false);
});
