import type { AgentName } from '../adapters/adapter-registry.js';

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

/** An always-on instruction file owned by a host, rendered from the shared entry content. */
export interface Instruction {
  path: string;
  render(content: string): string;
}

/** A regular file managed by Harnessmith inside an authorized root. */
export interface ManagedOutput {
  path: string;
  /** Authorization root when the output lives outside the adapter home. */
  root?: string;
}

/**
 * Mutable user-data paths (`~/.harnessmith` or `HARNESS_HOME`). User data is created once
 * and never rewritten or removed by installs; it is not a managed distribution scope and
 * carries no install record, entry, skill, or link.
 */
export interface UserDataPaths {
  /** Mutable user-data root: `~/.harnessmith` unless `HARNESS_HOME` overrides. */
  home: string;
  /** The user home used to derive default repository and user-data locations. */
  userHome: string;
  /** Mutable runtime state: `<home>/state` unless `HARNESS_STATE_HOME` overrides. */
  state: string;
  /** Shared personal rules overlay: `<home>/rules` unless `HARNESS_PERSONAL_HOME` overrides. */
  rules: string;
  /** Global non-authoritative memory: `<home>/memory` unless `HARNESS_MEMORY_HOME` overrides. */
  memory: string;
}

/**
 * A host Adapter owns rendered always-on instruction files, one install record chain, and
 * one operation lock. It references mutable user data but never manages it.
 */
export interface Adapter {
  scope: 'adapter';
  name: AgentName;
  label: string;
  /** Authorization root for outputs, records, backups and staging. */
  home: string;
  record: string;
  outputs: ManagedOutput[];
  localIgnoreFiles?: IgnoreFile[];
  userData: UserDataPaths;
  capabilities: AdapterCapabilities;
  project?: string;
  instructions: Instruction[];
}
