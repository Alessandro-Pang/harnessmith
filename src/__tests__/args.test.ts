import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { test } from 'vitest';
import { collectAgents, normalizeAgents } from '../agents.js';
import { executeCommand } from '../command-executor.js';
import { createProgram, type HarnessmithCommand } from '../program.js';
import type { CliOptions } from '../types.js';

test('Commander supports repeatable and comma-separated agent values', async () => {
  let result: (CliOptions & { command: HarnessmithCommand }) | undefined;
  const program = createProgram(async (command, options) => {
    result = { command, ...options };
  });
  await program.parseAsync(
    ['--agent', 'codex,cursor', '-a', 'claude-code', '--project', '/tmp/project', '--dry-run'],
    { from: 'user' },
  );
  assert.ok(result);
  assert.deepEqual(normalizeAgents(result.agent), ['codex', 'cursor', 'claude']);
  assert.equal(result.project, '/tmp/project');
  assert.equal(result.dryRun, true);
});

test('normalizeAgents expands all and rejects unknown agents', () => {
  assert.deepEqual(normalizeAgents(['all']), ['codex', 'cursor', 'claude']);
  assert.throws(() => normalizeAgents(['windsurf']), /Unsupported agent/);
});

test('Commander supports lifecycle commands and safety flags', async () => {
  let result: (CliOptions & { command: HarnessmithCommand }) | undefined;
  const program = createProgram(async (command, options) => {
    result = { command, ...options };
  });
  await program.parseAsync(['uninstall', '--agent', 'cursor', '--force'], { from: 'user' });
  assert.ok(result);
  assert.equal(result.command, 'uninstall');
  assert.equal(result.force, true);
});

test('Commander exposes adapter capabilities as a read-only command', async () => {
  let result: (CliOptions & { command: HarnessmithCommand }) | undefined;
  const program = createProgram(async (command, options) => {
    result = { command, ...options };
  });
  await program.parseAsync(['capabilities', '--agent', 'codex,cursor', '--json'], {
    from: 'user',
  });
  assert.ok(result);
  assert.equal(result.command, 'capabilities');
  assert.deepEqual(result.agent, ['codex', 'cursor']);
  assert.equal(result.json, true);
});

test('capabilities reports every adapter without resolving installation paths', async () => {
  const logs: string[] = [];
  const status = await executeCommand(
    'capabilities' as HarnessmithCommand,
    { agent: [], project: '/path/that/does/not/exist', json: true },
    {
      env: {},
      io: { log: (value) => logs.push(String(value)) },
      input: new PassThrough(),
      output: new PassThrough(),
    },
  );
  assert.equal(status, 0);
  const report = JSON.parse(logs[0]);
  assert.equal(report.version, 1);
  assert.deepEqual(
    report.adapters.map(({ agent }: { agent: string }) => agent),
    ['codex', 'cursor', 'claude'],
  );
  assert.equal(report.adapters[0].capabilities.enforcement.permissions, 'host-owned');
});

test('collectAgents accumulates repeated values', () => {
  assert.deepEqual(collectAgents('cursor,claude', ['codex']), ['codex', 'cursor', 'claude']);
});
