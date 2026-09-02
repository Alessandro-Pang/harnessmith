import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { test } from 'vitest';
import { collectAgents, normalizeAgents } from '../shared/agents.js';
import { executeCommand } from '../application/command-executor.js';
import { createProgram, type HarnessmithCommand } from '../app/program.js';
import type { CliOptions } from '../shared/types.js';

test('Commander supports repeatable and comma-separated agent values', async () => {
  let result: (CliOptions & { command: HarnessmithCommand }) | undefined;
  const program = createProgram(async (command, options) => {
    result = { command, ...options };
  });
  await program.parseAsync(
    [
      '--agent',
      'codex,cursor',
      '-a',
      'claude-code,opencode,kimi-code',
      '--project',
      '/tmp/project',
      '--dry-run',
    ],
    { from: 'user' },
  );
  assert.ok(result);
  assert.deepEqual(normalizeAgents(result.agent), [
    'codex',
    'cursor',
    'claude',
    'opencode',
    'kimi',
  ]);
  assert.equal(result.project, '/tmp/project');
  assert.equal(result.dryRun, true);
});

test('normalizeAgents expands all and rejects unknown agents', () => {
  assert.deepEqual(normalizeAgents(['all']), ['codex', 'cursor', 'claude', 'opencode', 'kimi']);
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

test('Commander exposes explain mode only through status options', async () => {
  let result: (CliOptions & { command: HarnessmithCommand }) | undefined;
  const program = createProgram(async (command, options) => {
    result = { command, ...options };
  });
  await program.parseAsync(['status', '--agent', 'codex', '--explain', '--json'], {
    from: 'user',
  });
  assert.ok(result);
  assert.equal(result.command, 'status');
  assert.equal(result.explain, true);
});

test('Commander exposes guided setup through the shared install options', async () => {
  let result: (CliOptions & { command: HarnessmithCommand }) | undefined;
  const program = createProgram(async (command, options) => {
    result = { command, ...options };
  });
  await program.parseAsync(
    ['setup', '--agent', 'cursor', '--project', '/tmp/project', '--dry-run', '--json'],
    { from: 'user' },
  );
  assert.ok(result);
  assert.equal(result.command, 'setup');
  assert.deepEqual(result.agent, ['cursor']);
  assert.equal(result.project, '/tmp/project');
  assert.equal(result.dryRun, true);
  assert.equal(result.json, true);
});

test('Commander exposes proposal-bound adopt options', async () => {
  let result: (CliOptions & { command: HarnessmithCommand }) | undefined;
  const program = createProgram(async (command, options) => {
    result = { command, ...options };
  });
  await program.parseAsync(
    ['adopt', '--agent', 'codex', '--proposal', 'sha256:abc', '--yes', '--json'],
    { from: 'user' },
  );
  assert.ok(result);
  assert.equal(result.command, 'adopt');
  assert.equal(result.proposal, 'sha256:abc');
  assert.equal(result.yes, true);
});

test('Commander exposes read-only diagnostics reports', async () => {
  let result: (CliOptions & { command: HarnessmithCommand }) | undefined;
  const program = createProgram(async (command, options) => {
    result = { command, ...options };
  });
  await program.parseAsync(['diagnostics', '--agent', 'codex', '--json'], { from: 'user' });
  assert.ok(result);
  assert.equal(result.command, 'diagnostics');
  assert.equal(result.json, true);
});

test('Commander exposes proposal-bound config export and import', async () => {
  const calls: Array<CliOptions & { command: HarnessmithCommand }> = [];
  const program = createProgram(async (command, options) => {
    calls.push({ command, ...options });
  });
  await program.parseAsync(['export', '--output', '/tmp/bundle.json', '--json'], {
    from: 'user',
  });
  await program.parseAsync(
    ['import', '--input', '/tmp/bundle.json', '--proposal', 'sha256:abc', '--yes', '--json'],
    { from: 'user' },
  );
  assert.equal(calls[0].command, 'export');
  assert.equal(calls[0].output, '/tmp/bundle.json');
  assert.equal(calls[1].command, 'import');
  assert.equal(calls[1].input, '/tmp/bundle.json');
  assert.equal(calls[1].proposal, 'sha256:abc');
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
    ['codex', 'cursor', 'claude', 'opencode', 'kimi'],
  );
  assert.equal(report.adapters[0].capabilities.enforcement.permissions, 'host-owned');
});

test('collectAgents accumulates repeated values', () => {
  assert.deepEqual(collectAgents('cursor,claude', ['codex']), ['codex', 'cursor', 'claude']);
});
