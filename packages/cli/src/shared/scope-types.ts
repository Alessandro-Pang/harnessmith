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

/**
 * An always-on instruction file owned by a host. `link` instructions are symlinks to the
 * hub entry so every host reads one shared file; `render` instructions are host-specific
 * copies (for example Cursor `.mdc` rules that need frontmatter).
 */
export type Instruction =
  | { path: string; mode: 'link' }
  | { path: string; mode: 'render'; render(content: string): string };

export type OutputKind = 'tree' | 'file' | 'link';

/** A filesystem path managed by Harnessmith inside an authorized root. */
export interface ManagedOutput {
  path: string;
  kind: OutputKind;
  /** Absolute path a `link` output must point at. */
  target?: string;
  /** Authorization root when the output lives outside the scope home. */
  root?: string;
}

/**
 * A directory scope that owns managed outputs, one install record chain, and one
 * operation lock. The shared hub and each host Adapter are both scopes.
 */
export interface ManagedScope {
  scope: 'hub' | 'adapter';
  name: string;
  label: string;
  /** Authorization root for outputs, records, backups and staging. */
  home: string;
  record: string;
  outputs: ManagedOutput[];
  localIgnoreFiles?: IgnoreFile[];
}

/**
 * The single rendered Harness shared by every host: `~/.agents/harnessmith` (or
 * `HARNESS_HOME`). Hosts only receive symlinks into it, so one upgrade reaches all of them.
 */
export interface Hub extends ManagedScope {
  scope: 'hub';
  name: 'hub';
  /** User home used to authorize pre-hub user-data migrations. */
  userHome: string;
  /** `~/.agents`: the skill catalog root scanned natively by several hosts. */
  agentsHome: string;
  /** Rendered always-on entry: `<home>/AGENTS.md`. */
  entry: string;
  /** Rendered `agent-harness` skill: `<home>/skills/agent-harness`. */
  harness: string;
  /** `~/.agents/skills/agent-harness` symlink for hosts that scan `~/.agents/skills`. */
  discoveryLink: string;
  /** Mutable runtime state: `<home>/state`. */
  state: string;
  /** Shared personal rules overlay: `<home>/rules` unless `HARNESS_PERSONAL_HOME` overrides. */
  rules: string;
  /** Global non-authoritative memory: `<home>/memory` unless `HARNESS_MEMORY_HOME` overrides. */
  memory: string;
  /** Pre-hub user-data locations that an install migrates once: `~/.agent-harness`, `~/.agent-docs`. */
  legacyRules: string;
  legacyMemory: string;
}

export interface Adapter extends ManagedScope {
  scope: 'adapter';
  name: AgentName;
  hub: Hub;
  /**
   * Host-visible skill symlink (`<home>/skills/agent-harness` → hub harness) for hosts
   * that do not scan `~/.agents/skills`; `null` when the host discovers the hub natively.
   */
  harness: string | null;
  /** Pre-3.0 harness copy (`<home>/agent-harness`), accepted for migration only. */
  legacyHarness: string;
  capabilities: AdapterCapabilities;
  project?: string;
  instructions: Instruction[];
}
