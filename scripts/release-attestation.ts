import type { ReleaseState } from './release-state.js';

export interface ReleaseAttestation {
  schemaVersion: 1;
  packageName: string;
  packageVersion: string;
  tag: string;
  artifactSha256: string;
  harnessVersion: string;
  rulesSha256: string;
  scenarios: Record<string, string>;
  requiredHosts: string[];
  coverageCount: number;
  assurance: 'maintainer-attested-structure';
  preparedAt: string;
}

export interface ReleaseSubject {
  packageName: string;
  packageVersion: string;
  tag: string;
  artifactSha256: string;
  harnessVersion: string;
  rulesSha256: string;
  scenarios: Record<string, string>;
  requiredHosts: string[];
}

export function createReleaseAttestation(
  packageName: string,
  state: ReleaseState,
): ReleaseAttestation {
  return {
    schemaVersion: 1,
    packageName,
    packageVersion: state.packageVersion,
    tag: `v${state.packageVersion}`,
    artifactSha256: state.artifactSha256,
    harnessVersion: state.evaluation.harnessVersion,
    rulesSha256: state.evaluation.rulesSha256,
    scenarios: state.evaluation.scenarios,
    requiredHosts: state.evaluation.requiredHosts,
    coverageCount: state.evaluation.coverageCount,
    assurance: state.evaluation.assurance,
    preparedAt: state.preparedAt,
  };
}

export function verifyReleaseAttestation(
  attestation: ReleaseAttestation,
  subject: ReleaseSubject,
): void {
  if (attestation.schemaVersion !== 1) throw new Error('Unsupported release attestation schema');
  if (attestation.packageName !== subject.packageName) {
    throw new Error('Release attestation package name does not match the candidate');
  }
  if (attestation.packageVersion !== subject.packageVersion || attestation.tag !== subject.tag) {
    throw new Error('Release attestation version or tag does not match the candidate');
  }
  if (attestation.artifactSha256 !== subject.artifactSha256) {
    throw new Error('Release attestation artifact digest does not match the candidate');
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
  if (
    attestation.assurance !== 'maintainer-attested-structure' ||
    attestation.requiredHosts.length === 0 ||
    attestation.coverageCount <
      attestation.requiredHosts.length * Object.keys(attestation.scenarios).length
  ) {
    throw new Error('Release attestation does not cover the required Host evaluation matrix');
  }
}
