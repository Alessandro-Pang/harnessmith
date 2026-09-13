import assert from 'node:assert/strict';
import {
  buildSemanticJudgePrompt,
  parseAgentJson,
  validateSemanticJudgeOutput,
} from '../../scripts/evaluation/codex/eval-semantic-review.js';
import type { SuiteCaseResult } from '../../scripts/evaluation/codex/eval-suite-evidence.js';
import { evaluationRegistry } from '../../scripts/evaluation/codex/eval-suite-registry.js';
import { evaluateCoverage } from '../../scripts/evaluation/contracts/eval-coverage.js';
import { suiteGateResult } from '../../scripts/evaluation/contracts/eval-suite-result.js';
import { validatePullRequest } from '../../scripts/evaluation/contracts/pr-contract.js';
import { coverMemoryFixtures, coverMemoryReport, coverMemoryState } from './scripts-c8-memory.js';
import { coverMemoryContract } from './scripts-c8-memory-contract.js';

function coverPullRequest(): void {
  assert.ok(validatePullRequest({ title: 'nope', body: '', headRef: 'main' }).length > 0);
  assert.ok(
    validatePullRequest({
      title: 'feat(search): add index',
      body: 'Closes #12',
      headRef: 'feat/99-other',
    }).some((error) => error.includes('#99')),
  );
  const clean = validatePullRequest({
    title: 'feat(search): add index',
    body: [
      '## Summary / 变更说明',
      '',
      '## Related Issue / 关联 Issue',
      'Closes #12',
      '',
      '## Verification / 验证',
      '',
      '## Checklist / 检查清单',
    ].join('\n'),
    headRef: 'feat/12-indexed-search',
  });
  assert.deepEqual(clean, []);
  assert.deepEqual(
    validatePullRequest({
      title: 'chore: bump',
      body: [
        '## Summary / 变更说明',
        'Closes #1',
        '## Related Issue / 关联 Issue',
        '## Verification / 验证',
        '## Checklist / 检查清单',
      ].join('\n'),
      headRef: 'dependabot/npm_and_yarn/left-pad-1.0.0',
    }),
    [],
  );
}

function coverCoverageAndSuite(): void {
  const empty = evaluateCoverage();
  assert.equal(empty.version, 2);
  assert.deepEqual(empty.memory.missing, []);
  const entries = evaluationRegistry();
  const results: SuiteCaseResult[] = entries
    .filter((entry) => entry.implemented)
    .map((entry) => ({
      scenarioId: entry.id,
      outcome: 'passed',
      termination: 'completed',
      attempts: 1,
      transportFailures: 0,
      recordRef: `local:${entry.id}`,
      recordSha256: 'a'.repeat(64),
      evidenceKinds: ['transcript', 'diff', 'observation', 'memory-state'],
    }));
  const measured = evaluateCoverage(results, entries);
  assert.ok(measured.memory.unmeasured.length < empty.memory.unmeasured.length);
  const gate = suiteGateResult(
    {
      results: [
        { scenarioId: 'progressive-disclosure', outcome: 'passed' },
        { scenarioId: 'blocked-host', outcome: 'infra-blocked' },
      ],
    } as Parameters<typeof suiteGateResult>[0],
    { packageArtifactSha256: 'pkg', behaviorSha256: 'beh' },
    7,
    ['codex'],
  );
  assert.equal(gate.valid, true);
  assert.deepEqual(gate.evidence.infraBlocked, ['codex/blocked-host']);
}

function coverSemanticReview(): void {
  const criteria = [
    {
      criterionId: 'pass-1',
      criterion: 'The persisted state reflects the requested preference',
      evidenceRefs: ['state'],
      task: 'profile',
    },
  ];
  const evidence = [
    { ref: 'state', content: 'profile key=communication.ordering value=risk-first' },
  ];
  const prompt = buildSemanticJudgePrompt(criteria, evidence);
  assert.match(prompt, /Return one JSON object/);
  assert.equal(parseAgentJson('not-json'), null);
  assert.equal(parseAgentJson('{"type":"other"}'), null);
  assert.deepEqual(
    parseAgentJson(
      JSON.stringify({
        type: 'item.completed',
        item: {
          type: 'agent_message',
          text: '{"decisions":[]}',
        },
      }),
    ),
    { decisions: [] },
  );
  assert.equal(
    parseAgentJson(
      JSON.stringify({
        type: 'item.completed',
        item: { type: 'agent_message', text: '```json\n{}\n```' },
      }),
    ),
    null,
  );
  assert.ok(validateSemanticJudgeOutput(null, [], evidence).errors.length > 0);
  assert.ok(validateSemanticJudgeOutput(null, criteria, evidence).errors.length > 0);
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
  assert.equal(valid.errors.length, 0);
  assert.ok(
    validateSemanticJudgeOutput({ decisions: [{ criterionId: 'pass-1' }] }, criteria, evidence)
      .errors.length > 0,
  );
  assert.ok(
    validateSemanticJudgeOutput(
      { decisions: [{ criterionId: 'missing', status: 'passed', evidence: [], rationale: 'x' }] },
      criteria,
      evidence,
    ).errors.length > 0,
  );
}

coverPullRequest();
coverCoverageAndSuite();
coverSemanticReview();
coverMemoryState();
coverMemoryContract();
coverMemoryFixtures();
coverMemoryReport();
