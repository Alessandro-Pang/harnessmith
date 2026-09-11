import type { Readable, Writable } from 'node:stream';
import type { AgentName } from '../adapters/adapter-registry.js';
import type { ManagedContentFingerprint } from './content-fingerprint-types.js';

export type {
  HubLifecyclePlan,
  LifecycleChange,
  LifecycleChangeAction,
  LifecycleCommand,
  LifecycleLayerPlan,
  LifecyclePlan,
} from './lifecycle-types.js';
export type {
  Adapter,
  AdapterCapabilities,
  Hub,
  IgnoreFile,
  Instruction,
  ManagedOutput,
  ManagedScope,
  OutputKind,
} from './scope-types.js';
export type { AgentName };

import type { Adapter, AdapterCapabilities, ManagedScope, OutputKind } from './scope-types.js';
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
  /** Recorded symlink target for `link` outputs; `copy` marks a host without symlink support. */
  link?: string;
  linkMode?: 'symlink' | 'copy';
}

/**
 * A managed output that was moved out of the way by a layout migration. The
 * previous layer owned `path`; this layer preserved it at `backup` so restore
 * and uninstall can put it back before the older record becomes active again.
 */
export interface MigratedOutput {
  path: string;
  backup: string;
}

/**
 * One installation layer. Schema 1 records were written by pre-hub installers for a host
 * that owned its own Harness copy; schema 2 records belong to either the hub
 * (`scope: 'hub'`, with `owners`) or a host Adapter (`scope: 'adapter'`, with `hub`).
 */
export interface InstallRecord {
  schemaVersion: 1 | 2;
  scope?: 'hub' | 'adapter';
  packageVersion: string;
  adapter?: AgentName;
  /**
   * Hub owner ids (`<agent>` for global hosts, `<agent>:<project>` for project-scoped
   * hosts) currently sharing the hub; the hub is removed with its last owner.
   */
  owners?: string[];
  /** Owner ids written in the same install transaction as this hub layer. */
  installed?: string[];
  /** Hub home this adapter layer links into. */
  hub?: string;
  /** Install transaction stamp shared by the hub layer and its adapter layers. */
  stamp?: string;
  installedAt: string;
  contentFingerprint?: string;
  outputs: RecordOutput[];
  migratedOutputs?: MigratedOutput[];
  ignoreFiles: string[];
  recordBackup: string | null;
}

export type MigrationAction = 'migrate-legacy-layout' | 'migrate-user-data';

export interface PlannedOutput {
  path: string;
  kind: OutputKind;
  target?: string;
  action: OutputAction;
  state: InstallTargetState;
}

export interface HubPlan {
  home: string;
  agentsHome: string;
  record: string;
  installed: boolean;
  owners: string[];
  state: string;
  rules: string;
  memory: string;
  outputs: PlannedOutput[];
  migrations: Array<{ path: string; action: MigrationAction }>;
}

export interface InstallPlan {
  adapter: AgentName;
  home: string;
  harness: string | null;
  record: string;
  capabilities: AdapterCapabilities;
  instructions: string[];
  initializeGlobalMemory: boolean;
  hub: HubPlan;
  /** Hub outputs first, then host outputs, so previews show the full effect. */
  outputs: PlannedOutput[];
  /** Paths this install would move to a same-directory backup (hub and host). */
  migrations: Array<{ path: string; action: MigrationAction }>;
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
  kind: OutputKind;
  root: string;
  link?: string;
  linkMode?: 'symlink' | 'copy';
}

export interface PreparedInstall {
  scope: ManagedScope;
  stageRoot: string;
  outputs: StagedOutput[];
  /** Paths that must be moved aside when this install commits. */
  migrations: Array<{ path: string; root: string; action: MigrationAction }>;
  /** User-data directories this install seeds from a migrated location (rules, memory, state). */
  seeds: Array<{ source: string; destination: string }>;
  seeded: string[];
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

export interface HubStatus {
  home: string;
  installed: boolean;
  record: string;
  owners: string[];
  packageVersion: string | null;
  installedAt: string | null;
  contentFingerprint: ManagedContentFingerprint;
  outputs: Array<{ path: string; status: ManagedStatus }>;
}

export interface AdapterStatus {
  adapter: AgentName;
  installed: boolean;
  record: string;
  capabilities: AdapterCapabilities;
  packageVersion: string | null;
  installedAt: string | null;
  /** Hub content fingerprint; host layers only hold links. */
  contentFingerprint: ManagedContentFingerprint;
  hub: HubStatus;
  /** Hub outputs first, then host outputs. */
  outputs: Array<{ path: string; status: ManagedStatus }>;
}

export interface AdapterStatusInspection {
  adapter: Adapter;
  status: AdapterStatus;
  record: InstallRecord | null;
  plan: InstallPlan;
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
