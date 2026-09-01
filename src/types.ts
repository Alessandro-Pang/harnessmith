import type { Readable, Writable } from 'node:stream';
import type { AgentName } from './adapter-registry.js';

export type { AgentName };
export type OutputAction = 'create' | 'replace-managed' | 'conflict';
export type InstallTargetState = 'missing' | 'managed' | 'modified' | 'unmanaged';
export type ManagedStatus = 'managed' | 'modified' | 'missing';

export interface Io {
  log(message?: unknown, ...optional: unknown[]): void;
  error?(message?: unknown, ...optional: unknown[]): void;
}

export interface Instruction {
  path: string;
  render(content: string): string;
}

export interface AdapterCapabilities {
  scope: 'global' | 'project';
  instructionFormat: 'markdown' | 'mdc';
  nativeRuleActivation: 'host-default' | 'always';
  enforcement: {
    fileOwnership: 'harnessmith';
    instructions: 'advisory';
    permissions: 'host-owned';
  };
}

export interface IgnoreFile {
  path: string;
  root?: string;
  lines: string[];
  preserveEmpty?: boolean;
}

export interface Adapter {
  name: AgentName;
  label: string;
  home: string;
  harness: string;
  record: string;
  capabilities: AdapterCapabilities;
  project?: string;
  instructions: Instruction[];
  localIgnoreFiles?: IgnoreFile[];
}

export interface RecordOutput {
  path: string;
  checksum: string;
  backup: string | null;
}

export interface InstallRecord {
  schemaVersion: 1;
  packageVersion: string;
  adapter: AgentName;
  installedAt: string;
  outputs: RecordOutput[];
  ignoreFiles: string[];
  recordBackup: string | null;
}

export interface InstallPlan {
  adapter: AgentName;
  home: string;
  harness: string;
  record: string;
  capabilities: AdapterCapabilities;
  instructions: string[];
  initializeGlobalMemory: boolean;
  outputs: Array<{ path: string; action: OutputAction; state: InstallTargetState }>;
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

export interface PreparedInstall {
  adapter: Adapter;
  stageRoot: string;
  outputs: Array<{ staged: string; destination: string }>;
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
  plan: InstallPlan;
}

export type LifecycleCommand = 'restore' | 'uninstall';
export type LifecycleChangeAction = 'remove' | 'restore-backup' | 'remove-managed-block';

export interface LifecycleChange {
  path: string;
  action: LifecycleChangeAction;
  source?: string;
}

export interface LifecycleLayerPlan {
  sourceRecord: string;
  changes: LifecycleChange[];
}

export interface LifecyclePlan {
  command: LifecycleCommand;
  adapter: AgentName;
  capabilities: AdapterCapabilities;
  home: string;
  layers: LifecycleLayerPlan[];
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
}

export interface RunContext {
  env?: NodeJS.ProcessEnv;
  io?: Io;
  input?: Readable & { isTTY?: boolean };
  output?: Writable & { isTTY?: boolean };
  error?: Writable;
}

export type HarnessmithErrorCode =
  | 'CLI_USAGE'
  | 'SAFETY_CONFLICT'
  | 'UNSAFE_PATH'
  | 'OPERATION_LOCKED'
  | 'INTEGRITY_ERROR'
  | 'STATE_CONFLICT'
  | 'INTERNAL_ERROR';

export class HarnessmithError extends Error {
  readonly code: HarnessmithErrorCode;
  readonly exitCode: number;

  constructor(
    code: HarnessmithErrorCode,
    message: string,
    exitCode: number,
    options: ErrorOptions = {},
  ) {
    super(message, options);
    this.name = 'HarnessmithError';
    this.code = code;
    this.exitCode = exitCode;
  }
}

export interface MachineErrorReport {
  version: 1;
  ok: false;
  error: {
    code: HarnessmithErrorCode;
    message: string;
    exitCode: number;
  };
}

export function machineErrorReport(error: unknown): MachineErrorReport {
  const commanderCode =
    error instanceof Error && 'code' in error
      ? String((error as Error & { code?: string }).code)
      : '';
  const failure =
    error instanceof HarnessmithError
      ? error
      : commanderCode.startsWith('commander.')
        ? new HarnessmithError('CLI_USAGE', errorMessage(error), 2, {
            cause: error instanceof Error ? error : undefined,
          })
        : new HarnessmithError('INTERNAL_ERROR', errorMessage(error), 1, {
            cause: error instanceof Error ? error : undefined,
          });
  return {
    version: 1,
    ok: false,
    error: {
      code: failure.code,
      message: failure.message,
      exitCode: failure.exitCode,
    },
  };
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
