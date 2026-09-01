import { createHash } from 'node:crypto';
import { sep } from 'node:path';
import { digestPath } from './files.js';
import type {
  MemoryPromotionOptions,
  MemoryPromotionProposal,
} from './memory-promotion-contract.js';

export type CurationAction = 'promote' | 'close' | 'supersede' | 'archive';

export interface CurationProposal {
  proposalId: string;
  action: CurationAction;
  reference: string;
  reason: string;
  sourceDigest: string;
  workspaceDigest: string;
  expiresOn: string;
  prerequisites: string[];
  verifier: { command: string; expected: 'exit 0' };
}

export interface CurationApplySelection {
  proposalId: string;
  replacement?: string;
  promotion?: MemoryPromotionOptions;
}

export interface CurationApplyItem {
  proposalId: string;
  action: CurationAction | 'unknown';
  reference: string | null;
  validation: {
    status: 'passed' | 'failed' | 'inconclusive';
    command: string;
    exitCode: number | null;
  };
  reason: string;
  recoveryPaths: string[];
  result?: MemoryPromotionProposal | { path: string };
}

export interface MemoryCurationApplyReport {
  version: 1;
  mode: 'applied';
  project: string;
  task: string;
  status: 'passed' | 'partial' | 'failed';
  items: CurationApplyItem[];
  remainingProposals: CurationProposal[];
  remainingValidation: {
    status: 'passed' | 'inconclusive';
    reason: string;
  };
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function curationWorkspaceDigest(project: string): string {
  const digest = digestPath(project, {
    exclude: (path) =>
      path === '.git' ||
      path.startsWith(`.git${sep}`) ||
      path === '.agent-docs' ||
      path.startsWith(`.agent-docs${sep}`),
    maxEntries: 100_000,
    maxBytes: 512 * 1024 * 1024,
    maxFileBytes: 128 * 1024 * 1024,
    maxDepth: 64,
    maxDurationMs: 30_000,
  });
  if (!digest) throw new Error(`Curation workspace digest is unavailable: ${project}`);
  return `sha256:${digest}`;
}

export function createCurationProposal(input: {
  action: CurationAction;
  reference: string;
  reason: string;
  sourceDigest: string;
  workspaceDigest: string;
  expiresOn: string;
  task: string;
  taskStatus: string;
  workstream: string;
  outcome: string;
}): CurationProposal {
  const prerequisites =
    input.action === 'promote'
      ? ['formal-promotion-options-required', 'formal-write-remains-separately-authorized']
      : input.action === 'supersede'
        ? ['replacement-memory-required', 'inbound-reference-and-cycle-check-required']
        : input.action === 'archive'
          ? ['inbound-reference-check-required']
          : ['typed-close-contract-required'];
  const verifier = {
    command:
      input.action === 'promote'
        ? 'harness memory promote <scope> <memory> ... --json'
        : `harness memory check <scope> --indexed --json`,
    expected: 'exit 0' as const,
  };
  const identity = {
    version: 1,
    ...input,
    prerequisites,
    verifier,
  };
  return {
    proposalId: `sha256:${createHash('sha256').update(stable(identity)).digest('hex')}`,
    action: input.action,
    reference: input.reference,
    reason: input.reason,
    sourceDigest: input.sourceDigest,
    workspaceDigest: input.workspaceDigest,
    expiresOn: input.expiresOn,
    prerequisites,
    verifier,
  };
}

export function boundedCurationSelections(
  selections: CurationApplySelection[],
): CurationApplySelection[] {
  if (selections.length < 1 || selections.length > 16) {
    throw new Error('Curation apply requires between 1 and 16 selected proposals');
  }
  const seen = new Set<string>();
  for (const selection of selections) {
    if (!/^sha256:[0-9a-f]{64}$/u.test(selection.proposalId)) {
      throw new Error('Curation selection has an invalid proposal id');
    }
    if (seen.has(selection.proposalId)) throw new Error('Curation selections must be unique');
    seen.add(selection.proposalId);
  }
  return selections;
}

export function curationRecoveryPaths(error: unknown): string[] {
  const message = error instanceof Error ? error.message : String(error);
  return [
    ...new Set(
      [...message.matchAll(/(?:recovery path|unresolved paths?):\s+([^;\n]+)/giu)].map((match) =>
        match[1].trim(),
      ),
    ),
  ];
}
