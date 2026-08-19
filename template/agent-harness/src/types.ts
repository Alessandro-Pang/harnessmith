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
}

export interface ProjectSnapshot {
  requested: string;
  root: string;
  name: string;
  isGitRepository: boolean;
  branch: string | null;
  head: string | null;
  dirty: boolean | null;
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

export interface AcceptanceCriterion {
  id: string;
  description: string;
  status: AcceptanceStatus;
  evidence: string[];
}

export interface TaskCheckpoint {
  time: string;
  summary: string;
  evidence: string[];
  nextAction?: string;
}

export interface TaskRecord {
  schemaVersion: 1;
  id: string;
  objective: string;
  status: TaskStatus;
  created: string;
  updated: string;
  projectRoot: string;
  nextAction: string;
  baseline: { branch: string | null; head: string | null; dirty: boolean | null };
  acceptance: AcceptanceCriterion[];
  checkpoints: TaskCheckpoint[];
}

export interface TaskSummary {
  id: string;
  objective: string;
  status: TaskStatus;
  updated: string;
  nextAction: string;
  acceptance: AcceptanceCriterion[];
  lastCheckpoint: TaskCheckpoint | null;
}

export type CheckStatus = 'passed' | 'warning' | 'failed';
export interface ValidationCheck {
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
