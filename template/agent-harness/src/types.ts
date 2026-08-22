export interface Io {
  log(message?: unknown, ...optional: unknown[]): void;
  error(message?: unknown, ...optional: unknown[]): void;
}

export interface InstallationContext {
  adapter?: string;
  harnessHome?: string;
  instructionFiles?: string[];
  memoryHome?: string;
  personalHome?: string;
  repositoryRoot?: string;
  owner?: string;
}

export interface Runtime {
  readonly env: NodeJS.ProcessEnv;
  readonly home: string;
  readonly harnessRoot: string;
  readonly distributionRoot: string;
  readonly harnessHome: string;
  readonly hostAdapter: string;
  readonly instructionFiles: string[];
  readonly installedHarness: string;
  readonly docsRoot: string;
  readonly memoryHome: string;
  readonly personalHome: string;
  readonly repositoryRoot: string;
  readonly owner: string;
  /** Test fixtures only. Production runtimes are derived from install-context.json. */
  readonly identityOverride?: 'test-fixture';
}

export interface ProjectSnapshot {
  requested: string;
  root: string;
  name: string;
  isGitRepository: boolean;
  branch: string | null;
  head: string | null;
  dirty: boolean | null;
  workspaceDigest: string | null;
  status: string[];
  agents: string[];
  docs: boolean;
  memory: { root: string; exists: boolean; initialized: boolean };
  packageManager: string | null;
  packageScripts: string[];
  manifests: string[];
}

export type TaskStatus = 'pending' | 'in_progress' | 'blocked' | 'complete' | 'superseded';
export type AcceptanceStatus = 'pending' | 'passed' | 'failed' | 'inconclusive';

interface TaskBaseline {
  branch: string | null;
  head: string | null;
  dirty: boolean | null;
}

interface TaskEvidenceBase {
  producer: 'harness' | 'external' | 'legacy';
  verificationPassed: boolean;
  taskId: string;
  criterionId: string | null;
  recordedAt: string;
  cwd: string;
  head: string | null;
  workspaceDigest: string | null;
  scopeDigests: Array<{ path: string; digest: string }>;
}

interface CommandTaskEvidence extends TaskEvidenceBase {
  type: 'command' | 'test';
  command: string;
  args: string[];
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  outputDigest: string | null;
}

interface ArtifactTaskEvidence extends TaskEvidenceBase {
  type: 'file' | 'diff';
  reference: string;
  artifactDigest: string;
}

interface ObservationTaskEvidence extends TaskEvidenceBase {
  type: 'browser' | 'observation';
  tool: string;
  result: string;
  host?: string;
}

interface LegacyTaskEvidence extends TaskEvidenceBase {
  type: 'legacy';
  reference: string;
}

export type TaskEvidence =
  | CommandTaskEvidence
  | ArtifactTaskEvidence
  | ObservationTaskEvidence
  | LegacyTaskEvidence;

interface AcceptanceCriterion {
  id: string;
  description: string;
  status: AcceptanceStatus;
  evidence: TaskEvidence[];
}

export interface TaskCheckpoint {
  time: string;
  summary: string;
  evidence: TaskEvidence[];
  nextAction?: string;
}

export interface TaskRecord {
  schemaVersion: 3;
  id: string;
  objective: string;
  status: TaskStatus;
  created: string;
  updated: string;
  projectRoot: string;
  nextAction: string;
  baseline: TaskBaseline;
  acceptance: AcceptanceCriterion[];
  checkpoints: TaskCheckpoint[];
}

export interface TaskBaselineDrift {
  branch: boolean;
  head: boolean;
  dirty: boolean;
  currentBranch: string | null;
  currentHead: string | null;
  currentDirty: boolean | null;
}

export interface TaskSummary {
  id: string;
  objective: string;
  status: TaskStatus;
  updated: string;
  nextAction: string;
  acceptance: AcceptanceCriterion[];
  lastCheckpoint: TaskCheckpoint | null;
  baselineDrift: TaskBaselineDrift;
}

export type CheckStatus = 'passed' | 'warning' | 'failed';
interface ValidationCheck {
  id: string;
  status: CheckStatus;
  message: string;
  path?: string;
}
export interface ValidationSummary {
  passed: number;
  warning: number;
  failed: number;
}
export interface ValidationReport {
  version: 1;
  checks: ValidationCheck[];
  summary: ValidationSummary;
  valid: boolean;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
