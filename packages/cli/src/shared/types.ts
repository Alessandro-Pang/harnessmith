import type { Readable, Writable } from 'node:stream';
import type { AgentName } from '../adapters/adapter-registry.js';

export type {
  LifecycleChange,
  LifecycleChangeAction,
  LifecycleCommand,
  LifecyclePlan,
} from './lifecycle-types.js';
export type {
  Adapter,
  AdapterCapabilities,
  IgnoreFile,
  Instruction,
  ManagedOutput,
  UserDataPaths,
} from './scope-types.js';
export type { AgentName };

import type { Adapter, AdapterCapabilities, UserDataPaths } from './scope-types.js';
export type OutputAction = 'create' | 'replace-managed' | 'conflict';
export type InstallTargetState = 'missing' | 'managed' | 'modified' | 'unmanaged';
export type ManagedStatus = 'managed' | 'modified' | 'missing';

export interface Io {
  log(message?: unknown, ...optional: unknown[]): void;
  error?(message?: unknown, ...optional: unknown[]): void;
}

export interface ExecuteContext {
  env: NodeJS.ProcessEnv;
  io: Io;
  input: Readable;
  output: Writable;
}

export interface RecordOutput {
  path: string;
  checksum: string;
  backup: string | null;
}

/**
 * One installation layer written by the current installer. Only schema 3 is accepted;
 * older or differently shaped records are rejected outright, never migrated.
 */
export interface InstallRecord {
  schemaVersion: 3;
  adapter: AgentName;
  packageVersion: string;
  installedAt: string;
  outputs: RecordOutput[];
  ignoreFiles: string[];
  recordBackup: string | null;
}

export interface PlannedOutput {
  path: string;
  action: OutputAction;
  state: InstallTargetState;
}

export interface InstallPlan {
  adapter: AgentName;
  home: string;
  record: string;
  capabilities: AdapterCapabilities;
  instructions: string[];
  initializeGlobalMemory: boolean;
  userData: UserDataPaths;
  outputs: PlannedOutput[];
}

export interface Backup {
  original: string;
  backup: string;
}

export interface Snapshot {
  path: string;
  existed: boolean;
  content: string | null;
  mode: number;
}

export interface StagedOutput {
  staged: string;
  destination: string;
  root: string;
  /** True when the current installation record already owns the destination. */
  managed: boolean;
}

export interface PreparedInstall {
  scope: Adapter;
  stageRoot: string;
  outputs: StagedOutput[];
  backups: Backup[];
  installed: string[];
  recordBackup: string | null;
  recordWritten: boolean;
  ignoreWritten: number;
  ignoreSnapshots: Snapshot[];
}

export interface InstallOptions {
  env?: NodeJS.ProcessEnv;
  force?: boolean;
  noInitGlobal?: boolean;
  stamp?: string;
  expectedOutputChecksums?: Record<string, string | null>;
  afterUserDataInitialize?: () => void;
}

export interface InstallResult extends InstallPlan {
  backups: Backup[];
  initialization: string;
}

export interface AdapterStatus {
  adapter: AgentName;
  installed: boolean;
  record: string;
  capabilities: AdapterCapabilities;
  packageVersion: string | null;
  installedAt: string | null;
  outputs: Array<{ path: string; status: ManagedStatus }>;
}

export interface AdapterStatusInspection {
  adapter: Adapter;
  status: AdapterStatus;
  record: InstallRecord | null;
}

export interface CliOptions {
  agent: string[];
  project: string;
  force?: boolean;
  json?: boolean;
  yes?: boolean;
  dryRun?: boolean;
  initGlobal?: boolean;
  explain?: boolean;
  proposal?: string;
  output?: string;
  input?: string;
}

export interface RunContext {
  env?: NodeJS.ProcessEnv;
  io?: Io;
  input?: Readable & { isTTY?: boolean };
  output?: Writable & { isTTY?: boolean };
  error?: Writable;
}

export {
  errorMessage,
  HarnessmithError,
  type HarnessmithErrorCode,
  type MachineErrorReport,
  machineErrorReport,
} from './errors.js';
