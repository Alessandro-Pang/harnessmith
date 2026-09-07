import { strict as assert } from 'node:assert';
import { test } from 'vitest';
import {
  buildSemanticJudgePrompt,
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
