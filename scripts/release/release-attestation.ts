import type {
  EvaluationEvidence,
  InheritedEvaluationSource,
} from '../evaluation/contracts/eval-contract.js';
import {
  evaluationMatrix,
  type ReleaseRiskAcceptance,
  type ReleaseState,
  releaseEvaluationEvidenceIsValid,
  releaseRiskAcceptanceIsValid,
} from './release-state.js';

export interface ReleaseAttestation {
  schemaVersion: 2 | 3 | 4 | 5;
  packageName: string;
  packageVersion: string;
  tag: string;
  artifactSha256: string;
  behaviorSha256: string;
  harnessVersion: string;
  rulesSha256: string;
  scenarios: Record<string, string>;
  requiredHosts: string[];
  coverageCount: number;
  exactArtifactCoverageCount: number;
  inheritedBehaviorCoverageCount: number;
  inheritedFrom: InheritedEvaluationSource[];
  evidence?: EvaluationEvidence;
  assurance: 'maintainer-attested-structure' | 'maintainer-attested-risk-exception';
  riskAcceptance?: ReleaseRiskAcceptance;
  preparedAt: string;
}

export interface ReleaseSubject {
  packageName: string;
  packageVersion: string;
  tag: string;
  artifactSha256: string;
  behaviorSha256: string;
  harnessVersion: string;
  rulesSha256: string;
  scenarios: Record<string, string>;
  requiredHosts: string[];
}

export function createReleaseAttestation(
  packageName: string,
  state: ReleaseState,
): ReleaseAttestation {
  const hasEvidence = state.evaluation.evidence !== undefined;
  return {
    schemaVersion: state.evaluation.riskAcceptance ? (hasEvidence ? 5 : 3) : hasEvidence ? 4 : 2,
    packageName,
    packageVersion: state.packageVersion,
    tag: `v${state.packageVersion}`,
    artifactSha256: state.artifactSha256,
    behaviorSha256: state.evaluation.behaviorSha256,
    harnessVersion: state.evaluation.harnessVersion,
    rulesSha256: state.evaluation.rulesSha256,
    scenarios: state.evaluation.scenarios,
    requiredHosts: state.evaluation.requiredHosts,
    coverageCount: state.evaluation.coverageCount,
    exactArtifactCoverageCount: state.evaluation.exactArtifactCoverageCount,
    inheritedBehaviorCoverageCount: state.evaluation.inheritedBehaviorCoverageCount,
    inheritedFrom: state.evaluation.inheritedFrom,
    ...(state.evaluation.evidence ? { evidence: state.evaluation.evidence } : {}),
    assurance: state.evaluation.assurance,
    ...(state.evaluation.riskAcceptance ? { riskAcceptance: state.evaluation.riskAcceptance } : {}),
    preparedAt: state.preparedAt,
  };
}

export function verifyReleaseAttestation(
  attestation: ReleaseAttestation,
  subject: ReleaseSubject,
): void {
  if (![2, 3, 4, 5].includes(attestation.schemaVersion)) {
    throw new Error('Unsupported release attestation schema');
  }
  if (attestation.packageName !== subject.packageName) {
    throw new Error('Release attestation package name does not match the candidate');
  }
  if (attestation.packageVersion !== subject.packageVersion || attestation.tag !== subject.tag) {
    throw new Error('Release attestation version or tag does not match the candidate');
  }
  if (attestation.artifactSha256 !== subject.artifactSha256) {
    throw new Error('Release attestation artifact digest does not match the candidate');
  }
  if (attestation.behaviorSha256 !== subject.behaviorSha256) {
    throw new Error('Release attestation behavior fingerprint does not match the candidate');
  }
  if (
    attestation.harnessVersion !== subject.harnessVersion ||
    attestation.rulesSha256 !== subject.rulesSha256
  ) {
    throw new Error('Release attestation Harness rules do not match the candidate');
  }
  if (JSON.stringify(attestation.scenarios) !== JSON.stringify(subject.scenarios)) {
    throw new Error('Release attestation scenarios do not match the candidate');
  }
  if (JSON.stringify(attestation.requiredHosts) !== JSON.stringify(subject.requiredHosts)) {
    throw new Error('Release attestation required Hosts do not match release policy');
  }
  const coverageShapeValid =
    attestation.exactArtifactCoverageCount + attestation.inheritedBehaviorCoverageCount !==
    attestation.coverageCount
      ? false
      : (attestation.inheritedBehaviorCoverageCount === 0
          ? attestation.inheritedFrom.length === 0
          : attestation.inheritedFrom.length > 0) && attestation.requiredHosts.length > 0;
  const requiresEvidence = [4, 5].includes(attestation.schemaVersion);
  const evidenceValid = releaseEvaluationEvidenceIsValid(
    attestation.evidence,
    attestation.exactArtifactCoverageCount,
    attestation.inheritedBehaviorCoverageCount,
    attestation.inheritedFrom,
    attestation.requiredHosts,
    attestation.scenarios,
  );
  const fullCoverage =
    attestation.assurance === 'maintainer-attested-structure' &&
    [2, 4].includes(attestation.schemaVersion) &&
    !attestation.riskAcceptance &&
    (!requiresEvidence || attestation.evidence?.infraBlocked.length === 0) &&
    attestation.coverageCount >=
      attestation.requiredHosts.length * Object.keys(attestation.scenarios).length;
  const risk = attestation.riskAcceptance;
  const acceptedRisk =
    attestation.assurance === 'maintainer-attested-risk-exception' &&
    [3, 5].includes(attestation.schemaVersion) &&
    attestation.coverageCount === 0 &&
    releaseRiskAcceptanceIsValid(
      risk,
      subject.artifactSha256,
      subject.packageVersion,
      evaluationMatrix(subject.requiredHosts, subject.scenarios),
    ) &&
    (!requiresEvidence ||
      JSON.stringify(attestation.evidence?.infraBlocked) ===
        JSON.stringify(risk?.infraBlockedScenarios ?? []));
  if (requiresEvidence && !evidenceValid) {
    throw new Error('Release attestation Host evaluation evidence is invalid');
  }
  if (!coverageShapeValid || (!fullCoverage && !acceptedRisk) || (fullCoverage && acceptedRisk)) {
    throw new Error('Release attestation does not cover the required Host evaluation matrix');
  }
}
