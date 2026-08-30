import assert from 'node:assert/strict';
import {
  evaluationMatrix,
  releaseEvaluationEvidenceIsValid,
} from '../../scripts/release-evaluation-evidence.js';

const digest = 'a'.repeat(64);
const source = { packageVersion: '0.8.0', packageArtifactSha256: digest };
const hosts = ['codex'];
const scenarios = { one: 'b'.repeat(64), two: 'c'.repeat(64) };

assert.deepEqual(evaluationMatrix(hosts, scenarios), ['codex/one', 'codex/two']);
assert.equal(
  releaseEvaluationEvidenceIsValid(
    {
      exact: ['codex/one'],
      inherited: [{ cell: 'codex/two', ...source }],
      infraBlocked: [],
    },
    1,
    1,
    [source],
    hosts,
    scenarios,
  ),
  true,
);

for (const invalid of [
  null,
  [],
  {},
  { exact: [], inherited: [], infraBlocked: ['codex/unknown'] },
  { exact: ['codex/one'], inherited: [], infraBlocked: ['codex/one'] },
  {
    exact: [],
    inherited: [{ cell: 'codex/one', packageVersion: '', packageArtifactSha256: digest }],
    infraBlocked: [],
  },
  {
    exact: [],
    inherited: [{ cell: 'codex/one', packageVersion: '0.8.0', packageArtifactSha256: 'invalid' }],
    infraBlocked: [],
  },
]) {
  assert.equal(releaseEvaluationEvidenceIsValid(invalid, 0, 0, [], hosts, scenarios), false);
}

assert.equal(
  releaseEvaluationEvidenceIsValid(
    { exact: [], inherited: [{ cell: 'codex/one', ...source }], infraBlocked: [] },
    0,
    1,
    [{ packageVersion: '0.7.0', packageArtifactSha256: digest }],
    hosts,
    scenarios,
  ),
  false,
);
