import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'vitest';
import { buildReasoningResult } from '../../scripts/evaluation/codex/eval-codex-reasoning-observer.js';
import { createCodexHostEvalExecutor } from '../../scripts/evaluation/codex/eval-codex-transport.js';
import { temporaryDirectory } from './run-fixture.js';

const validEvents = [
  '{"type":"item.completed","item":{"type":"agent_message","text":"done"}}',
  '{"type":"turn.completed"}',
].join('\n');

function noModeRepo(): string {
  const repo = temporaryDirectory();
  mkdirSync(join(repo, '.harness-eval', 'fixtures'), { recursive: true });
  writeFileSync(join(repo, '.harness-eval', 'fixtures', 'simple.txt'), 'ready\n');
  writeFileSync(join(repo, '.harness-eval', 'reasoning-result.json'), '{"text":"done"}\n');
  return repo;
}

const noModeScenario = {
  id: 'reasoning-no-mode',
  prompt: 'local static fixture',
  mode: '',
  activation: 'none' as const,
  requiredArtifacts: [],
  fixture: { facts: {}, output: { text: 'done' } },
};

test('F10 shared Codex completion rejects malformed JSONL and partial agent events', async () => {
  const { evaluateCodexTurnCompletion } = await import(
    // @ts-expect-error Plain ESM evaluator module.
    '../../scripts/evaluation/codex/eval-codex-support.mjs'
  );
  for (const stdout of [
    '{"type":"turn.completed"}\n',
    `${validEvents}\nnot-json`,
    '{"type":"item.started","item":{"type":"agent_message","text":"partial"}}\n{"type":"turn.completed"}',
  ]) {
    const completion = evaluateCodexTurnCompletion({
      status: 0,
      signal: null,
      error: null,
      stdout,
      stderr: '',
    });
    assert.equal(completion.completed, false, stdout);
  }
  assert.equal(
    evaluateCodexTurnCompletion({
      status: 0,
      signal: null,
      error: null,
      stdout: validEvents,
      stderr: '',
    }).completed,
    true,
  );
});

test('F10 transport executor does not call a passing evaluator for an incomplete turn', async () => {
  let evaluated = false;
  const execute = createCodexHostEvalExecutor({
    workspace: '/tmp/eval',
    promptForScenario: () => 'fixture',
    runProcess: async () => ({
      kind: 'completed',
      exitCode: 0,
      stdout: '{"type":"turn.completed"}\n',
      stderr: '',
    }),
    evaluate: async () => {
      evaluated = true;
      return { outcome: 'passed', termination: 'completed' };
    },
  });

  const result = await execute({
    scenarioId: 'progressive-disclosure',
    attempt: 1,
    maxAttempts: 2,
    deadlineMs: Date.now() + 1000,
    signal: new AbortController().signal,
  });

  assert.deepEqual(result, { outcome: 'evaluator-failed', termination: 'evaluator-failure' });
  assert.equal(evaluated, false);
});

test('F10 reasoning requires complete JSONL, turn.completed, and a completed agent message', () => {
  for (const stdout of ['', '{"type":"turn.completed"}\n', `${validEvents}\nmalformed`]) {
    const result = buildReasoningResult(noModeScenario, noModeRepo(), {
      kind: 'completed',
      exitCode: 0,
      stdout,
      stderr: '',
    });
    assert.equal(result.outcome, 'evaluator-failed', stdout || '(empty stdout)');
  }
  assert.equal(
    buildReasoningResult(noModeScenario, noModeRepo(), {
      kind: 'completed',
      exitCode: 0,
      stdout: validEvents,
      stderr: '',
    }).outcome,
    'passed',
  );
});
