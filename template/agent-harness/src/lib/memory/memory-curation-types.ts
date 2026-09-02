import type { TaskStatus } from '../../types.js';
import type { CurationProposal } from './memory-curation-contract.js';

export type CurationOutcome =
  | 'phase-complete'
  | 'task-complete'
  | 'workstream-complete'
  | 'user-cancel';

export interface CurationOptions {
  task: string;
  workstream?: string;
  outcome?: CurationOutcome;
  json?: boolean;
}

export interface CurationCandidate {
  reference: string;
  reason: string;
}

export interface MemoryCurationReport {
  version: 1;
  mode: 'proposal-only';
  project: string;
  task: string;
  taskStatus: TaskStatus;
  workstream: string;
  outcome: CurationOutcome;
  result: 'none' | 'candidates';
  promoteCandidates: CurationProposal[];
  closeCandidates: CurationProposal[];
  supersedeCandidates: CurationProposal[];
  archiveCandidates: CurationProposal[];
  skipped: CurationCandidate[];
}

export interface CurationCommandOptions extends CurationOptions {
  apply?: string[];
  applyFile?: string;
  yes?: boolean;
}
