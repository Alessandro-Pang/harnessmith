export const officialRegistry = 'https://registry.npmjs.org/';

interface CommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export type RegistryVerificationRunner = (
  executable: string,
  args: string[],
  options: RunOptions,
) => CommandResult;

export interface RegistryMetadata {
  version?: string;
  dist?: {
    tarball?: string;
    shasum?: string;
    integrity?: string;
    attestations?: {
      url?: string;
      provenance?: { predicateType?: string };
    };
  };
}

export interface RegistryVerificationOptions {
  evidenceFile: string;
  expectedArtifact: string;
  maxAttempts: number;
  packageName: string;
  requireProvenance: boolean;
  retryDelayMs: number;
  version: string;
}

export interface RegistryVerificationReport {
  version: 1;
  valid: true;
  package: { name: string; version: string };
  registry: {
    url: string;
    tarball: string;
    provenance: boolean;
    attempts: number;
  };
  artifact: { sha1: string; sha256: string; integrity: string };
  smoke: {
    version: true;
    capabilities: true;
    dryRunNoWrite: true;
    install: true;
    doctor: true;
    health: true;
  };
  verifiedAt: string;
}

export type RegistryVerificationErrorCode =
  | 'REGISTRY_PROPAGATION_TIMEOUT'
  | 'REGISTRY_METADATA_MISMATCH'
  | 'REGISTRY_INTEGRITY_MISMATCH'
  | 'REGISTRY_RUNTIME_FAILURE';

export interface RegistryVerificationFailureReport {
  version: 1;
  valid: false;
  package: { name: string; version: string };
  registry: { url: string; attempts: number };
  error: { code: RegistryVerificationErrorCode; message: string };
  recoveryPath: string;
  verifiedAt: string;
}

export class RegistryVerificationError extends Error {
  readonly code: RegistryVerificationErrorCode;
  readonly attempts: number;

  constructor(code: RegistryVerificationErrorCode, message: string, attempts = 0) {
    super(message);
    this.name = 'RegistryVerificationError';
    this.code = code;
    this.attempts = attempts;
  }
}

export class RegistryVerificationFailure extends Error {
  readonly report: RegistryVerificationFailureReport;

  constructor(report: RegistryVerificationFailureReport, cause: unknown) {
    super(
      `${report.error.code}: ${report.error.message}; recovery data retained at: ${report.recoveryPath}`,
      { cause: cause instanceof Error ? cause : undefined },
    );
    this.name = 'RegistryVerificationFailure';
    this.report = report;
  }
}
