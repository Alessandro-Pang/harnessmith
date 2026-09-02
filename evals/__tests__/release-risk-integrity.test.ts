import assert from 'node:assert/strict';
import { test } from 'vitest';
import { verifyReleaseAttestation } from '../../scripts/release/release-attestation.js';
import { releaseRiskAcceptanceIsValid } from '../../scripts/release/release-state.js';

test('risk acceptance covers the exact canonical uncovered evaluation matrix', () => {
  const acceptance = {
    schemaVersion: 1 as const,
    acceptedAt: '2026-08-26T09:00:00.000Z',
    authorizedBy: 'user' as const,
    reason: 'Explicitly accepted the complete uncovered matrix.',
    uncoveredScenarios: ['claude/one', 'claude/two'],
    packageVersion: '0.7.0',
    packageArtifactSha256: 'a'.repeat(64),
  };

  assert.equal(
    releaseRiskAcceptanceIsValid(
      acceptance,
      acceptance.packageArtifactSha256,
      acceptance.packageVersion,
      ['claude/one', 'claude/two'],
    ),
    true,
  );
  assert.equal(
    releaseRiskAcceptanceIsValid(
      { ...acceptance, uncoveredScenarios: ['claude/one'] },
      acceptance.packageArtifactSha256,
      acceptance.packageVersion,
      ['claude/one', 'claude/two'],
    ),
    false,
  );
  assert.equal(
    releaseRiskAcceptanceIsValid(
      { ...acceptance, uncoveredScenarios: ['claude-code/one', 'claude-code/two'] },
      acceptance.packageArtifactSha256,
      acceptance.packageVersion,
      ['claude/one', 'claude/two'],
    ),
    false,
  );
  assert.equal(
    releaseRiskAcceptanceIsValid(
      { ...acceptance, infraBlockedScenarios: ['claude/three'] },
      acceptance.packageArtifactSha256,
      acceptance.packageVersion,
      ['claude/one', 'claude/two'],
    ),
    false,
  );
});

test('release attestation rejects a risk exception for only part of the uncovered matrix', () => {
  const digestValue = 'a'.repeat(64);
  const subject = {
    packageName: 'harnessmith',
    packageVersion: '0.7.0',
    tag: 'v0.7.0',
    artifactSha256: digestValue,
    behaviorSha256: 'b'.repeat(64),
    harnessVersion: '2.6.0',
    rulesSha256: 'c'.repeat(64),
    scenarios: { one: 'd'.repeat(64), two: 'e'.repeat(64) },
    requiredHosts: ['codex'],
  };
  const riskAcceptance = {
    schemaVersion: 1 as const,
    acceptedAt: '2026-08-26T09:00:00.000Z',
    authorizedBy: 'user' as const,
    reason: 'Accepted only one uncovered cell.',
    uncoveredScenarios: ['codex/one'],
    packageVersion: subject.packageVersion,
    packageArtifactSha256: subject.artifactSha256,
  };

  assert.throws(
    () =>
      verifyReleaseAttestation(
        {
          schemaVersion: 3,
          ...subject,
          coverageCount: 0,
          exactArtifactCoverageCount: 0,
          inheritedBehaviorCoverageCount: 0,
          inheritedFrom: [],
          assurance: 'maintainer-attested-risk-exception',
          riskAcceptance,
          preparedAt: '2026-08-26T09:05:00.000Z',
        },
        subject,
      ),
    /does not cover the required Host evaluation matrix/i,
  );
});

test('release attestation rejects overlapping passing and infrastructure-blocked evidence', () => {
  const digestValue = 'a'.repeat(64);
  const subject = {
    packageName: 'harnessmith',
    packageVersion: '0.9.0',
    tag: 'v0.9.0',
    artifactSha256: digestValue,
    behaviorSha256: 'b'.repeat(64),
    harnessVersion: '2.8.0',
    rulesSha256: 'c'.repeat(64),
    scenarios: { one: 'd'.repeat(64) },
    requiredHosts: ['codex'],
  };

  assert.throws(
    () =>
      verifyReleaseAttestation(
        {
          schemaVersion: 4,
          ...subject,
          coverageCount: 1,
          exactArtifactCoverageCount: 1,
          inheritedBehaviorCoverageCount: 0,
          inheritedFrom: [],
          evidence: {
            exact: ['codex/one'],
            inherited: [],
            infraBlocked: ['codex/one'],
          },
          assurance: 'maintainer-attested-structure',
          preparedAt: '2026-08-30T09:00:00.000Z',
        },
        subject,
      ),
    /Host evaluation evidence/i,
  );
});

test('release attestation accepts an infra-blocked subset only under an exact risk exception', () => {
  const digestValue = 'a'.repeat(64);
  const subject = {
    packageName: 'harnessmith',
    packageVersion: '0.9.0',
    tag: 'v0.9.0',
    artifactSha256: digestValue,
    behaviorSha256: 'b'.repeat(64),
    harnessVersion: '2.8.0',
    rulesSha256: 'c'.repeat(64),
    scenarios: { one: 'd'.repeat(64), two: 'e'.repeat(64) },
    requiredHosts: ['codex'],
  };
  const riskAcceptance = {
    schemaVersion: 1 as const,
    acceptedAt: '2026-08-30T09:00:00.000Z',
    authorizedBy: 'user' as const,
    reason: 'Accepted the exact uncovered matrix.',
    uncoveredScenarios: ['codex/one', 'codex/two'],
    infraBlockedScenarios: ['codex/two'],
    packageVersion: subject.packageVersion,
    packageArtifactSha256: subject.artifactSha256,
  };

  assert.doesNotThrow(() =>
    verifyReleaseAttestation(
      {
        schemaVersion: 5,
        ...subject,
        coverageCount: 0,
        exactArtifactCoverageCount: 0,
        inheritedBehaviorCoverageCount: 0,
        inheritedFrom: [],
        evidence: {
          exact: [],
          inherited: [],
          infraBlocked: ['codex/two'],
        },
        assurance: 'maintainer-attested-risk-exception',
        riskAcceptance,
        preparedAt: '2026-08-30T09:00:00.000Z',
      },
      subject,
    ),
  );
});

test('release attestation fails closed with a stable error for malformed inherited evidence', () => {
  const subject = {
    packageName: 'harnessmith',
    packageVersion: '0.9.0',
    tag: 'v0.9.0',
    artifactSha256: 'a'.repeat(64),
    behaviorSha256: 'b'.repeat(64),
    harnessVersion: '2.8.0',
    rulesSha256: 'c'.repeat(64),
    scenarios: { one: 'd'.repeat(64) },
    requiredHosts: ['codex'],
  };

  assert.throws(
    () =>
      verifyReleaseAttestation(
        {
          schemaVersion: 4,
          ...subject,
          coverageCount: 1,
          exactArtifactCoverageCount: 0,
          inheritedBehaviorCoverageCount: 1,
          inheritedFrom: [{ packageVersion: '0.8.0', packageArtifactSha256: 'e'.repeat(64) }],
          evidence: {
            exact: [],
            inherited: [null] as never,
            infraBlocked: [],
          },
          assurance: 'maintainer-attested-structure',
          preparedAt: '2026-08-30T09:00:00.000Z',
        },
        subject,
      ),
    /Host evaluation evidence is invalid/i,
  );
});
