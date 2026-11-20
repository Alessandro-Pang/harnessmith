import type { AgentName } from '../adapters/adapter-registry.js';

export type LifecycleCommand = 'restore' | 'uninstall';
export type LifecycleChangeAction = 'remove' | 'restore-backup' | 'remove-managed-block' | 'keep';

export interface LifecycleChange {
  path: string;
  action: LifecycleChangeAction;
  source?: string;
}

/** Read-only dry-run preview for one current installation record. */
export interface LifecyclePlan {
  command: LifecycleCommand;
  adapter: AgentName;
  force: boolean;
  home: string;
  changes: LifecycleChange[];
}
