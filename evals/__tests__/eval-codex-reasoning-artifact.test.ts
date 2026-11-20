import assert from 'node:assert/strict';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'vitest';
import { buildReasoningResult } from '../../scripts/evaluation/codex/eval-codex-reasoning-observer.js';
import { temporaryDirectory } from './run-fixture.js';

const validEvents = [
  '{"type":"item.completed","item":{"type":"agent_message","text":"done"}}',
  '{"type":"turn.completed"}',
].join('\n');

const scenario = {
  id: 'reasoning-artifact-fixture',
  prompt: 'local static fixture',
  mode: '',
  activation: 'none' as const,
  requiredArtifacts: [],
  fixture: { facts: {}, output: { text: 'done' } },
};

function makeRepo(): string {
  const repo = temporaryDirectory();
  mkdirSync(join(repo, '.harness-eval', 'fixtures'), { recursive: true });
  writeFileSync(join(repo, '.harness-eval', 'fixtures', 'simple.txt'), 'ready\n');
  return repo;
}

function evaluate(repo: string) {
  return buildReasoningResult(scenario, repo, {
    kind: 'completed',
    exitCode: 0,
    stdout: validEvents,
    stderr: '',
  });
}

function resultPath(repo: string): string {
  return join(repo, '.harness-eval', 'reasoning-result.json');
}

test('F17 reasoning result larger than 64 KiB is an evaluator failure', () => {
  const repo = makeRepo();
  writeFileSync(resultPath(repo), JSON.stringify({ text: 'done', padding: 'x'.repeat(65 * 1024) }));
  assert.equal(evaluate(repo).outcome, 'evaluator-failed');
});

test('F17 reasoning result symlink is an evaluator failure', () => {
  const repo = makeRepo();
  const target = join(repo, 'outside-result.json');
  writeFileSync(target, '{"text":"done"}\n');
  symlinkSync(target, resultPath(repo), 'file');
  assert.equal(evaluate(repo).outcome, 'evaluator-failed');
});

test('F17 non-regular reasoning result is an evaluator failure', () => {
  const repo = makeRepo();
  mkdirSync(resultPath(repo));
  assert.equal(evaluate(repo).outcome, 'evaluator-failed');
});

test('F17 malformed reasoning result JSON is an evaluator failure', () => {
  const repo = makeRepo();
  writeFileSync(resultPath(repo), '{"text":');
  assert.equal(evaluate(repo).outcome, 'evaluator-failed');
});

test('F17 non-object reasoning result is an evaluator failure', () => {
  const repo = makeRepo();
  writeFileSync(resultPath(repo), '["done"]\n');
  assert.equal(evaluate(repo).outcome, 'evaluator-failed');
});

test('F17 reasoning result field with the wrong schema type is an evaluator failure', () => {
  const repo = makeRepo();
  writeFileSync(resultPath(repo), '{"text":42}\n');
  assert.equal(evaluate(repo).outcome, 'evaluator-failed');
});

test('F17 bounded regular reasoning result remains valid', () => {
  const repo = makeRepo();
  writeFileSync(resultPath(repo), '{"text":"done"}\n');
  assert.equal(evaluate(repo).outcome, 'passed');
});
