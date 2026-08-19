import assert from 'node:assert/strict';
import { test } from 'vitest';
import { collectAgents, normalizeAgents } from '../agents.js';
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

test('collectAgents accumulates repeated values', () => {
  assert.deepEqual(collectAgents('cursor,claude', ['codex']), ['codex', 'cursor', 'claude']);
});
