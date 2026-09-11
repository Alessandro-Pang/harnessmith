import type { AgentName } from '../adapters/adapter-registry.js';
import type { AdapterCapabilities } from './scope-types.js';

export type LifecycleCommand = 'restore' | 'uninstall';
export type LifecycleChangeAction =
  | 'remove'
  | 'restore-backup'
  | 'restore-migrated'
  | 'remove-managed-block';

export interface LifecycleChange {
  path: string;
  action: LifecycleChangeAction;
  source?: string;
}

export interface LifecycleLayerPlan {
  sourceRecord: string;
  changes: LifecycleChange[];
}

export interface HubLifecyclePlan {
  home: string;
  /** `release` drops this host from the owners; `layers` lists hub layers that unwind. */
  action: 'keep' | 'release' | 'unwind';
  layers: LifecycleLayerPlan[];
}

export interface LifecyclePlan {
  command: LifecycleCommand;
  adapter: AgentName;
  capabilities: AdapterCapabilities;
  home: string;
  layers: LifecycleLayerPlan[];
  hub: HubLifecyclePlan;
}
