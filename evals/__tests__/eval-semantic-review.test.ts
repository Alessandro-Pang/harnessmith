import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'vitest';
import {
  buildSemanticJudgePrompt,
  createIsolatedSemanticJudgeEnvironment,
  runSemanticReview,
  validateSemanticJudgeOutput,
} from '../../scripts/evaluation/codex/eval-semantic-review.js';

const criteria = [
  {
    criterionId: 'pass-1',
    criterion: 'The persisted state reflects the requested preference',
    evidenceRefs: ['state'],
    task: 'profile',
  },
];
const evidence = [{ ref: 'state', content: 'profile key=communication.ordering value=risk-first' }];

test('semantic judge prompt is a bounded rubric and evidence contract', () => {
  const prompt = buildSemanticJudgePrompt(criteria, evidence);
  assert.match(prompt, /Return one JSON object/);
  assert.match(prompt, /profile key=communication\.ordering/);
  assert.match(prompt, /Do not modify files, run commands/);
});

test('semantic judge accepts only exact evidence excerpts', () => {
  const valid = validateSemanticJudgeOutput(
    {
      decisions: [
        {
          criterionId: 'pass-1',
          status: 'passed',
          evidence: [{ ref: 'state', excerpt: 'profile key=communication.ordering' }],
          rationale: 'The state contains the requested key.',
        },
      ],
    },
    criteria,
    evidence,
  );
  assert.deepEqual(valid.errors, []);
  assert.equal(valid.decisions[0]?.status, 'passed');
  const invalid = validateSemanticJudgeOutput(
    {
      decisions: [
        {
          criterionId: 'pass-1',
          status: 'passed',
          evidence: [{ ref: 'state', excerpt: 'not in state' }],
          rationale: 'I think it passed.',
        },
      ],
    },
    criteria,
    evidence,
  );
  assert.ok(invalid.errors.some((error) => error.includes('exact bounded substring')));
});

test('missing, duplicate, and unknown semantic decisions are inconclusive inputs', () => {
  const missing = validateSemanticJudgeOutput({ decisions: [] }, criteria, evidence);
  assert.ok(missing.errors.some((error) => error.includes('missing criterionId')));
  const duplicate = validateSemanticJudgeOutput(
    {
      decisions: [
        { criterionId: 'pass-1', status: 'failed', evidence: [], rationale: 'first' },
        { criterionId: 'pass-1', status: 'passed', evidence: [], rationale: 'second' },
      ],
    },
    criteria,
    evidence,
  );
  assert.ok(duplicate.errors.some((error) => error.includes('duplicate criterionId')));
  const unknown = validateSemanticJudgeOutput(
    {
      decisions: [{ criterionId: 'pass-99', status: 'passed', evidence: [], rationale: 'unknown' }],
    },
    criteria,
    evidence,
  );
  assert.ok(unknown.errors.some((error) => error.includes('unknown criterionId')));
});

test('semantic judge uses an isolated CODEX_HOME and removes it afterwards', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'harness-semantic-workspace-'));
  const original = process.env.CODEX_HOME;
  process.env.CODEX_HOME = join(tmpdir(), 'developer-codex-home');
  let seenHome: string | undefined;
  try {
    const result = await runSemanticReview({
      criteria,
      evidence,
      workspace,
      runProcess: async ({ invocation }) => {
        seenHome = invocation.env?.CODEX_HOME;
        assert.ok(seenHome);
        assert.notEqual(seenHome, process.env.CODEX_HOME);
        assert.ok(existsSync(seenHome));
        return {
          kind: 'completed',
          exitCode: 0,
          stdout: `${JSON.stringify({
            type: 'item.completed',
            item: {
              type: 'agent_message',
              text: JSON.stringify({
                decisions: [
                  {
                    criterionId: 'pass-1',
                    status: 'passed',
                    evidence: [{ ref: 'state', excerpt: 'profile key=communication.ordering' }],
                    rationale: 'isolated',
                  },
                ],
              }),
            },
          })}\n`,
          stderr: '',
        };
      },
    });
    assert.equal(result.outcome, 'passed');
    assert.ok(seenHome);
    assert.equal(existsSync(seenHome), false);
  } finally {
    if (original === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = original;
  }
});

test('isolated semantic judge homes are mode 700 and cleaned up', () => {
  const isolated = createIsolatedSemanticJudgeEnvironment();
  assert.notEqual(isolated.env.CODEX_HOME, process.env.CODEX_HOME);
  assert.ok(isolated.env.CODEX_HOME && existsSync(isolated.env.CODEX_HOME));
  isolated.cleanup();
  assert.equal(existsSync(isolated.env.CODEX_HOME as string), false);
});
