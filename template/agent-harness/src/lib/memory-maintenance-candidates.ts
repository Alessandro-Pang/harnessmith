import type { MemoryCoreBudgetReport } from './memory-core-budget.js';

type MemoryMaintenanceCategory =
  | 'duplicate'
  | 'stale'
  | 'contradicted'
  | 'expired'
  | 'unindexed'
  | 'broken-reference'
  | 'cycle'
  | 'budget'
  | 'fact-source'
  | 'input-review'
  | 'purpose';

type MemoryMaintenanceAction =
  | 'index'
  | 'archive'
  | 'review-duplicate'
  | 'review-supersession'
  | 'repair-reference'
  | 'compress-core'
  | 'inspect-source'
  | 'migrate-input'
  | 'review-input'
  | 'review-purpose';

export interface MemoryMaintenanceCandidate {
  id: string;
  category: MemoryMaintenanceCategory;
  outcome: 'proposed' | 'inconclusive';
  reasonCode: string;
  evidence: string[];
  suggestedAction: MemoryMaintenanceAction;
  risk: 'low' | 'medium' | 'high';
  eligibility: {
    status: 'not-evaluated';
    reasonCode: 'maintenance-eligibility-input-unavailable';
  };
}

export interface MaintenanceDocument {
  name: string;
  documentType: string;
  status: string;
  memoryKind: string;
  sourceRefs: string[];
  missingSourceRefs: string[];
  references: string[];
}

interface LegacyMaintenanceFields {
  unindexed: string[];
  expiredWorking: string[];
  closed: string[];
  duplicateTitles: Array<{ title: string; paths: string[] }>;
  supersessionCycles: string[][];
  legacyInputs: string[];
  genericActionInputs: string[];
  workstreamInputs: string[];
  genericDescriptions: string[];
  duplicatePurposes: Array<{ purpose: string; paths: string[] }>;
  splitProposals: Array<{ path: string; reasons: string[] }>;
  coreBudget: MemoryCoreBudgetReport;
}

function candidate(
  category: MemoryMaintenanceCategory,
  reasonCode: string,
  evidence: string[],
  suggestedAction: MemoryMaintenanceAction,
  risk: MemoryMaintenanceCandidate['risk'],
  outcome: MemoryMaintenanceCandidate['outcome'] = 'proposed',
): MemoryMaintenanceCandidate {
  return {
    id: `${category}:${reasonCode}:${evidence.join('|')}`,
    category,
    outcome,
    reasonCode,
    evidence,
    suggestedAction,
    risk,
    eligibility: {
      status: 'not-evaluated',
      reasonCode: 'maintenance-eligibility-input-unavailable',
    },
  };
}

function legacyCandidates(fields: LegacyMaintenanceFields): MemoryMaintenanceCandidate[] {
  return [
    ...fields.unindexed.map((path) =>
      candidate('unindexed', 'active-memory-unindexed', [path], 'index', 'medium'),
    ),
    ...fields.expiredWorking.map((path) =>
      candidate('expired', 'working-memory-expired', [path], 'archive', 'low'),
    ),
    ...fields.closed.map((path) =>
      candidate('stale', 'closed-memory-retained', [path], 'archive', 'low'),
    ),
    ...fields.duplicateTitles.map(({ title, paths }) =>
      candidate(
        'duplicate',
        'duplicate-active-title',
        [title, ...paths],
        'review-duplicate',
        'medium',
      ),
    ),
    ...fields.supersessionCycles.map((cycle) =>
      candidate('cycle', 'supersession-cycle', cycle, 'review-supersession', 'high'),
    ),
    ...fields.legacyInputs.map((path) =>
      candidate('input-review', 'legacy-input-schema', [path], 'migrate-input', 'medium'),
    ),
    ...fields.genericActionInputs.map((path) =>
      candidate('input-review', 'generic-action-input', [path], 'review-input', 'medium'),
    ),
    ...fields.workstreamInputs.map((path) =>
      candidate('input-review', 'active-workstream-input', [path], 'review-input', 'low'),
    ),
    ...fields.genericDescriptions.map((path) =>
      candidate('purpose', 'generic-description', [path], 'review-purpose', 'medium'),
    ),
    ...fields.duplicatePurposes.map(({ purpose, paths }) =>
      candidate(
        'duplicate',
        'duplicate-document-purpose',
        [purpose, ...paths],
        'review-duplicate',
        'medium',
      ),
    ),
    ...fields.splitProposals.map(({ path, reasons }) =>
      candidate(
        'purpose',
        'multiple-document-purposes',
        [path, ...reasons],
        'review-purpose',
        'medium',
      ),
    ),
    ...(fields.coreBudget.status === 'ok'
      ? []
      : [
          candidate(
            'budget',
            `core-${fields.coreBudget.status}`,
            [
              `lines:${fields.coreBudget.lines}`,
              `bytes:${fields.coreBudget.bytes}`,
              ...fields.coreBudget.compressionCandidates,
            ],
            'compress-core',
            fields.coreBudget.status === 'hard-limit' ? 'high' : 'medium',
          ),
        ]),
  ];
}

export function buildMemoryMaintenanceCandidates(
  fields: LegacyMaintenanceFields,
  documents: MaintenanceDocument[],
): MemoryMaintenanceCandidate[] {
  const names = new Set(documents.map(({ name }) => name.replace(/\.md$/u, '').toLowerCase()));
  const candidates = legacyCandidates(fields);
  for (const document of documents) {
    if (document.status === 'superseded') {
      candidates.push(
        candidate('contradicted', 'memory-superseded', [document.name], 'archive', 'medium'),
      );
    }
    if (
      ['active', 'blocked'].includes(document.status) &&
      document.memoryKind === 'distilled' &&
      ['analytical-finding', 'operational-experience', 'distilled-memory'].includes(
        document.documentType,
      ) &&
      (document.sourceRefs.length === 0 || document.missingSourceRefs.length > 0)
    ) {
      candidates.push(
        candidate(
          'fact-source',
          'source-evidence-missing',
          [document.name, ...document.missingSourceRefs],
          'inspect-source',
          'high',
          'inconclusive',
        ),
      );
    }
    for (const reference of document.references) {
      if (!names.has(reference)) {
        candidates.push(
          candidate(
            'broken-reference',
            'memory-reference-missing',
            [document.name, `memory:${reference}`],
            'repair-reference',
            'high',
          ),
        );
      }
    }
  }
  return candidates.sort((left, right) => left.id.localeCompare(right.id));
}

export function summarizeMemoryMaintenance(candidates: MemoryMaintenanceCandidate[]) {
  const count = (field: 'category' | 'outcome') =>
    Object.fromEntries(
      [...new Set(candidates.map((item) => item[field]))]
        .sort()
        .map((value) => [value, candidates.filter((item) => item[field] === value).length]),
    );
  return {
    result:
      candidates.length === 0
        ? ('none' as const)
        : candidates.some(({ outcome }) => outcome === 'inconclusive')
          ? ('inconclusive' as const)
          : ('proposed' as const),
    totalCandidates: candidates.length,
    byCategory: count('category'),
    byOutcome: count('outcome'),
  };
}
