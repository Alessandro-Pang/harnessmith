import {
  type CurationDocument,
  canonicalMemoryReference,
  loadCurationDocuments,
} from '../../lib/memory/memory-curation-documents.js';
import { buildCurationProposals } from '../../lib/memory/memory-curation-proposals.js';
import type {
  CurationCandidate,
  CurationOptions,
  CurationOutcome,
  MemoryCurationReport,
} from '../../lib/memory/memory-curation-types.js';
import { validateMemoryRoot } from '../../lib/memory/memory-validation.js';
import { assertNoHighConfidenceSecret } from '../../lib/security/secret-hygiene.js';
import { projectRoot, readTask } from '../../lib/task/task-store.js';
import { otherTaskOwners, taskReferences } from '../../lib/workflow/workflow-relations.js';
import { calendarDate } from '../../runtime.js';
import type { Io, Runtime, TaskStatus } from '../../types.js';

export type { CurationApplySelection } from '../../lib/memory/memory-curation-contract.js';

export type {
  CurationOptions,
  MemoryCurationReport,
} from '../../lib/memory/memory-curation-types.js';

const outcomes = new Set<CurationOutcome>([
  'phase-complete',
  'task-complete',
  'workstream-complete',
  'user-cancel',
]);

function defaultOutcome(status: TaskStatus): CurationOutcome {
  return status === 'complete' ? 'task-complete' : 'phase-complete';
}

function authoritativeSources(sourceRefs: string[]): string[] {
  return sourceRefs.filter((reference) =>
    /^(?:docs?|adr|test|tests|schema|schemas|src)\//i.test(reference),
  );
}

function related(document: CurationDocument, task: string, workstream: string): boolean {
  return (
    document.sourceRefs.includes(`task:${task}`) ||
    document.workstream === workstream ||
    document.session === workstream ||
    document.name.startsWith(`working/${task}/`)
  );
}

function candidate(document: CurationDocument, reason: string): CurationCandidate {
  return { reference: document.reference, reason };
}

interface CandidateBuckets {
  promote: CurationCandidate[];
  close: CurationCandidate[];
  supersede: CurationCandidate[];
  archive: CurationCandidate[];
  skipped: CurationCandidate[];
}

const activeStatuses = new Set(['active', 'blocked']);
function addArchiveCandidate(
  document: CurationDocument,
  all: CurationDocument[],
  today: string,
  buckets: CandidateBuckets,
): boolean {
  const expired =
    activeStatuses.has(document.status) &&
    document.kind === 'working' &&
    document.expires !== undefined &&
    document.expires < today;
  if (!expired && !['complete', 'superseded'].includes(document.status)) return false;
  const owners = taskReferences(document.sourceRefs);
  if (owners.length > 1) {
    buckets.skipped.push(
      candidate(
        document,
        `shared task owners remain: ${owners.map((owner) => `task:${owner}`).join(', ')}`,
      ),
    );
    return false;
  }
  const identity = canonicalMemoryReference(document.reference);
  const inbound = all.filter(
    (source) =>
      source.reference !== document.reference &&
      activeStatuses.has(source.status) &&
      source.references.includes(identity),
  );
  if (inbound.length > 0) {
    buckets.skipped.push(
      candidate(
        document,
        `active inbound reference from ${inbound.map(({ reference }) => reference).join(', ')}`,
      ),
    );
    return false;
  }
  buckets.archive.push(
    candidate(
      document,
      expired ? 'working memory is expired' : `memory status is ${document.status}`,
    ),
  );
  return true;
}

function analyzeDocument(
  document: CurationDocument,
  all: CurationDocument[],
  outcome: CurationOutcome,
  today: string,
  buckets: CandidateBuckets,
  task: string,
): void {
  let actionable = false;
  if (
    activeStatuses.has(document.status) &&
    ['analytical-finding', 'operational-experience'].includes(document.type)
  ) {
    buckets.promote.push(
      candidate(document, 'typed finding or experience requires owner-authorized promotion review'),
    );
    actionable = true;
  }
  const workstreamState =
    (document.kind === 'input' && document.retention === 'workstream') ||
    document.type === 'session-handoff';
  const closesWithWorkstream = ['workstream-complete', 'user-cancel'].includes(outcome);
  if (activeStatuses.has(document.status) && workstreamState && closesWithWorkstream) {
    const sharedOwners = otherTaskOwners(document.sourceRefs, task);
    if (sharedOwners.length > 0) {
      buckets.skipped.push(
        candidate(
          document,
          `shared task owner remains: ${sharedOwners.map((owner) => `task:${owner}`).join(', ')}`,
        ),
      );
    } else {
      buckets.close.push(candidate(document, `workstream outcome is ${outcome}`));
      actionable = true;
    }
  } else if (activeStatuses.has(document.status) && workstreamState) {
    buckets.skipped.push(candidate(document, 'workstream continues after this task or phase'));
  }
  const sources = authoritativeSources(document.sourceRefs);
  if (activeStatuses.has(document.status) && document.kind === 'distilled' && sources.length > 0) {
    buckets.supersede.push(
      candidate(document, `formal source is already referenced: ${sources.join(', ')}`),
    );
    actionable = true;
  }
  actionable = addArchiveCandidate(document, all, today, buckets) || actionable;
  if (!actionable && !buckets.skipped.some(({ reference }) => reference === document.reference)) {
    buckets.skipped.push(
      candidate(document, 'no curation action is justified by current evidence'),
    );
  }
}

function outputCuration(report: MemoryCurationReport, json: boolean, io: Io): void {
  if (json) {
    io.log(JSON.stringify(report, null, 2));
    return;
  }
  io.log(`Memory curation: ${report.result}`);
  io.log(`Promote candidates: ${report.promoteCandidates.length}`);
  io.log(`Close candidates: ${report.closeCandidates.length}`);
  io.log(`Supersede candidates: ${report.supersedeCandidates.length}`);
  io.log(`Archive candidates: ${report.archiveCandidates.length}`);
}

export function curateMemory(
  runtime: Runtime,
  project: string,
  options: CurationOptions,
  io: Io = console,
): MemoryCurationReport {
  assertNoHighConfidenceSecret(
    [project, options.task, options.workstream ?? '', options.outcome ?? ''],
    'Memory curation request',
  );
  if (!options.task?.trim()) throw new Error('Memory curation requires a task id');
  const root = projectRoot(project);
  const memoryRoot = `${root}/.agent-docs`;
  validateMemoryRoot(memoryRoot, io, { quietSuccess: true, rootKind: 'project' });
  const task = readTask(root, options.task).value;
  const outcome = options.outcome ?? defaultOutcome(task.status);
  if (!outcomes.has(outcome)) throw new Error(`Invalid curation outcome: ${String(outcome)}`);
  const workstream = options.workstream?.trim() || task.id;
  if (!workstream || /\r|\n/.test(workstream)) {
    throw new Error('Memory curation workstream must be one bounded line');
  }
  const all = loadCurationDocuments(memoryRoot);
  const scoped = all.filter((document) => related(document, task.id, workstream));
  const buckets: CandidateBuckets = {
    promote: [],
    close: [],
    supersede: [],
    archive: [],
    skipped: [],
  };
  const today = calendarDate(runtime);
  for (const document of scoped) analyzeDocument(document, all, outcome, today, buckets, task.id);

  const result =
    buckets.promote.length +
      buckets.close.length +
      buckets.supersede.length +
      buckets.archive.length >
    0
      ? 'candidates'
      : 'none';
  const proposals = buildCurationProposals({
    project: root,
    documents: all,
    candidates: buckets,
    expiresOn: today,
    task: task.id,
    taskStatus: task.status,
    workstream,
    outcome,
  });
  const report: MemoryCurationReport = {
    version: 1,
    mode: 'proposal-only',
    project: root,
    task: task.id,
    taskStatus: task.status,
    workstream,
    outcome,
    result,
    promoteCandidates: proposals.promote,
    closeCandidates: proposals.close,
    supersedeCandidates: proposals.supersede,
    archiveCandidates: proposals.archive,
    skipped: buckets.skipped,
  };
  outputCuration(report, Boolean(options.json), io);
  return report;
}
